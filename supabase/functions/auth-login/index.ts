// =============================================================================
// Supabase Edge Function: auth-login
// Security Hardening — SEC-004, SEC-008, SEC-009, SEC-010
//
// Security Model:
// - Replaces direct anon client calls to resolve_login_identifier(TEXT) so
//   unauthenticated callers can NEVER enumerate active usernames or resolve
//   usernames to user email addresses (SEC-004).
// - Explicit CORS allowlist (ALLOWED_ORIGINS, defaults to
//   https://operation-lms.vercel.app; NEVER wildcard '*' and NEVER arbitrary
//   origin reflection). Unauthorized origins receive HTTP 403. Origin-less
//   POST requests emit no Access-Control-Allow-Origin header and remain fully
//   governed by fail-closed rate limiting.
// - Distributed PostgreSQL-backed FIXED-WINDOW rate limiting (SEC-010) via
//   cits_internal.auth_login_rate_limits (SHA-256 hashed trusted IP &
//   normalized identifier keys; 10 failed attempts / 15-min fixed window per
//   identifier, 25 failed attempts / 15-min fixed window per trusted IP ->
//   HTTP 429 + Retry-After). Successful logins do NOT reset failure counters,
//   preventing IP-bucket reset abuse via dummy accounts.
// - FAIL-CLOSED rate-limit enforcement (SEC-008): if either the pre-auth check
//   or post-failure recording RPC fails or returns a malformed payload, the
//   function logs a sanitized operational error (zero DB internals/PII), does
//   NOT authenticate credentials, and returns HTTP 503 + Retry-After: 60.
// - Spoof-resistant IP extraction (SEC-009): trusts ONLY `cf-connecting-ip`
//   (overwritten by Cloudflare edge ingress in front of hosted Supabase Edge
//   Functions), strictly validated as IPv4/IPv6. NEVER trusts client-spoofable
//   `x-forwarded-for` or `x-real-ip`. If `cf-connecting-ip` is absent/invalid,
//   routes into a shared fallback bucket ('untrusted-source') so header
//   spoofing cannot rotate IP buckets; per-identifier limits remain active.
// - Streaming UTF-8 byte-limited request reader (8,192 bytes max -> HTTP 413),
//   NFKC + trim + lowercase identifier normalization, uniform non-enumerable
//   HTTP 401 ('Invalid credentials or account unavailable.'), 500ms + 0..50ms
//   CSPRNG timing floor on failure paths, Cache-Control: no-store, and zero
//   credential/token logging.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

interface LoginRequestBody {
  identifier?: string;
  password?: string;
}

interface RateLimitRpcResult {
  allowed: boolean;
  retry_after_seconds: number;
  ip_count?: number;
  identifier_count?: number;
}

const DEFAULT_PRODUCTION_ORIGINS = ['https://operation-lms.vercel.app'];
const MAX_BODY_BYTES = 8_192;
const UNIFORM_AUTH_ERROR = 'Invalid credentials or account unavailable.';
const SERVICE_UNAVAILABLE_ERROR =
  'Authentication service is temporarily unavailable. Please try again shortly.';
const MIN_AUTH_FAILURE_RESPONSE_MS = 500;
const TIMING_JITTER_MAX_MS = 50;
const UNTRUSTED_IP_FALLBACK_KEY = 'untrusted-source';

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_REGEX = /^[0-9a-f:]{2,45}$/i;
const CONTROL_CHAR_REGEX = /[\u0000-\u001f\u007f]/;

// Staging-only, exact Vercel origins. Production keeps its configured CORS policy.
const STAGING_PREVIEW_ORIGINS = [
  'https://gleaming-skyblue-heron-54.hostingersite.com',
  'https://operation-ca6y7khe0-salah-2543.vercel.app',
  'https://operation-lms-git-design-graphite-glass-respo-56f62e-salah-2543.vercel.app',
];

function stagingPreviewOrigins(): string[] {
  const stagingRef = 'uewhudbufykfkhimvqjj';
  try {
    const host = new URL(Deno.env.get('SUPABASE_URL') || '').hostname;
    if (host === stagingRef + '.supabase.co') return STAGING_PREVIEW_ORIGINS;
  } catch {
    // No Supabase URL: fail closed instead of trusting the caller's Origin.
  }
  return Deno.env.get('SUPABASE_PROJECT_REF') === stagingRef
    ? STAGING_PREVIEW_ORIGINS : [];
}

function resolveAllowedOrigins(): string[] {
  const raw = (Deno.env.get('ALLOWED_ORIGINS') || '').trim();
  if (!raw) {
    return [...DEFAULT_PRODUCTION_ORIGINS, ...stagingPreviewOrigins()];
  }

  const parsed: string[] = [];
  for (const part of raw.split(',')) {
    const candidate = part.trim().replace(/\/+$/, '');
    if (!candidate || candidate === '*') continue;
    try {
      const url = new URL(candidate);
      const isHttps = url.protocol === 'https:';
      const isExplicitLocalDev =
        url.protocol === 'http:' &&
        (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
      if (isHttps || isExplicitLocalDev) {
        if (!parsed.includes(url.origin)) {
          parsed.push(url.origin);
        }
      }
    } catch {
      // Skip malformed entries
    }
  }

  return [...new Set([...(parsed.length > 0 ? parsed : DEFAULT_PRODUCTION_ORIGINS), ...stagingPreviewOrigins()])];
}

function evaluateOriginPolicy(
  req: Request,
  allowedOrigins: string[]
): {
  allowed: boolean;
  originHeader: string | null;
  corsHeaders: Record<string, string>;
} {
  const rawOrigin = req.headers.get('Origin');
  const origin = rawOrigin ? rawOrigin.trim().replace(/\/+$/, '') : null;

  if (!origin) {
    // Non-browser / server-to-server call: no ACAO header emitted; rate limiting still enforced.
    return {
      allowed: true,
      originHeader: null,
      corsHeaders: { Vary: 'Origin' },
    };
  }

  if (!allowedOrigins.includes(origin)) {
    return {
      allowed: false,
      originHeader: origin,
      corsHeaders: { Vary: 'Origin' },
    };
  }

  return {
    allowed: true,
    originHeader: origin,
    corsHeaders: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}

function jsonResponse(
  corsHeaders: Record<string, string>,
  status: number,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      Pragma: 'no-cache',
      ...extraHeaders,
    },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function isValidIpAddress(candidate: string): boolean {
  if (!candidate || candidate.length > 45) return false;
  if (IPV4_REGEX.test(candidate)) return true;
  if (candidate.includes(':') && IPV6_REGEX.test(candidate)) return true;
  return false;
}

/**
 * SEC-009: Extract client IP ONLY from `cf-connecting-ip`, which Cloudflare
 * edge ingress unconditionally sets/overwrites for hosted Supabase Edge
 * Functions. NEVER trust client-controllable `x-forwarded-for` or `x-real-ip`.
 * If `cf-connecting-ip` is missing/invalid, route into a shared fallback bucket
 * ('untrusted-source') so header spoofing cannot rotate IP rate-limit buckets.
 */
function extractTrustedClientIp(req: Request): string {
  const cfIp = (req.headers.get('cf-connecting-ip') || '').trim().toLowerCase();
  if (isValidIpAddress(cfIp)) {
    return cfIp;
  }
  return UNTRUSTED_IP_FALLBACK_KEY;
}

function isValidRateLimitPayload(value: unknown): value is RateLimitRpcResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.allowed === 'boolean' &&
    typeof obj.retry_after_seconds === 'number' &&
    Number.isFinite(obj.retry_after_seconds)
  );
}

function randomJitterMs(): number {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % (TIMING_JITTER_MAX_MS + 1);
}

async function applyMinimumFailureTimingFloor(startedAt: number): Promise<void> {
  const targetMs = MIN_AUTH_FAILURE_RESPONSE_MS + randomJitterMs();
  const elapsed = Date.now() - startedAt;
  const remaining = targetMs - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

async function readBodyWithByteLimit(
  req: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false; status: 400 | 413; error: string }> {
  if (!req.body) {
    return { ok: false, status: 400, error: 'Request body is required.' };
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          await reader.cancel();
          return {
            ok: false,
            status: 413,
            error: 'Request payload exceeds maximum allowed size.',
          };
        }
        chunks.push(value);
      }
    }
  } catch {
    return { ok: false, status: 400, error: 'Unable to read request body.' };
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return { ok: true, text: new TextDecoder('utf-8', { fatal: true }).decode(merged) };
  } catch {
    return { ok: false, status: 400, error: 'Request body must be valid UTF-8.' };
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const allowedOrigins = resolveAllowedOrigins();
  const originPolicy = evaluateOriginPolicy(req, allowedOrigins);

  try {
    if (req.method === 'OPTIONS') {
      if (!originPolicy.originHeader || !originPolicy.allowed) {
        return jsonResponse({ Vary: 'Origin' }, 403, {
          ok: false,
          error: 'Origin not allowed.',
        });
      }
      return new Response(null, { status: 204, headers: originPolicy.corsHeaders });
    }

    if (!originPolicy.allowed) {
      return jsonResponse({ Vary: 'Origin' }, 403, {
        ok: false,
        error: 'Origin not allowed.',
      });
    }

    if (req.method !== 'POST') {
      return jsonResponse(originPolicy.corsHeaders, 405, {
        ok: false,
        error: 'Method not allowed.',
      });
    }

    const contentLengthHeader = req.headers.get('Content-Length');
    if (contentLengthHeader) {
      const parsedLength = Number(contentLengthHeader);
      if (Number.isFinite(parsedLength) && parsedLength > MAX_BODY_BYTES) {
        return jsonResponse(originPolicy.corsHeaders, 413, {
          ok: false,
          error: 'Request payload exceeds maximum allowed size.',
        });
      }
    }

    const supabaseUrl = (Deno.env.get('SUPABASE_URL') || '').trim();
    const supabaseAnonKey = (Deno.env.get('SUPABASE_ANON_KEY') || '').trim();
    const supabaseServiceRoleKey = (Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '').trim();

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error('[auth-login] Missing required Supabase server environment variables.');
      return jsonResponse(
        originPolicy.corsHeaders,
        503,
        { ok: false, error: SERVICE_UNAVAILABLE_ERROR },
        { 'Retry-After': '60' }
      );
    }

    const bodyRead = await readBodyWithByteLimit(req, MAX_BODY_BYTES);
    if (!bodyRead.ok) {
      return jsonResponse(originPolicy.corsHeaders, bodyRead.status, {
        ok: false,
        error: bodyRead.error,
      });
    }

    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyRead.text);
    } catch {
      return jsonResponse(originPolicy.corsHeaders, 400, {
        ok: false,
        error: 'Invalid JSON request body.',
      });
    }

    if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
      return jsonResponse(originPolicy.corsHeaders, 400, {
        ok: false,
        error: 'Request body must be a JSON object.',
      });
    }

    const body = parsedBody as LoginRequestBody;
    const rawIdentifier = typeof body.identifier === 'string' ? body.identifier : '';
    const cleanIdentifier = rawIdentifier.normalize('NFKC').trim().toLowerCase();
    const password = typeof body.password === 'string' ? body.password : '';

    if (
      !cleanIdentifier ||
      cleanIdentifier.length > 120 ||
      CONTROL_CHAR_REGEX.test(cleanIdentifier) ||
      !password ||
      password.length > 256
    ) {
      return jsonResponse(originPolicy.corsHeaders, 400, {
        ok: false,
        error: 'Username/email and password are required.',
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const trustedIpKey = extractTrustedClientIp(req);
    const [ipHash, identifierHash] = await Promise.all([
      sha256Hex(`ip:${trustedIpKey}`),
      sha256Hex(`id:${cleanIdentifier}`),
    ]);

    // 1. SEC-008: Pre-auth distributed fixed-window rate-limit check (STRICT FAIL-CLOSED)
    const { data: preRateData, error: preRateErr } = await adminClient.rpc(
      'evaluate_login_rate_limit_internal',
      {
        p_ip_hash: ipHash,
        p_identifier_hash: identifierHash,
        p_increment: false,
      }
    );

    if (preRateErr || !isValidRateLimitPayload(preRateData)) {
      console.error('[auth-login] Rate-limit pre-check failed closed.', {
        reason: preRateErr ? 'rpc_error' : 'invalid_payload',
        code: preRateErr?.code || 'INVALID_PAYLOAD',
      });
      await applyMinimumFailureTimingFloor(startedAt);
      return jsonResponse(
        originPolicy.corsHeaders,
        503,
        { ok: false, error: SERVICE_UNAVAILABLE_ERROR },
        { 'Retry-After': '60' }
      );
    }

    if (preRateData.allowed === false) {
      const retryAfter = Math.max(60, Math.ceil(preRateData.retry_after_seconds || 900));
      return jsonResponse(
        originPolicy.corsHeaders,
        429,
        {
          ok: false,
          error: 'Too many sign-in attempts. Please wait before trying again.',
        },
        { 'Retry-After': String(retryAfter) }
      );
    }

    const recordFailedAttemptAndRespond = async (): Promise<Response> => {
      const { data: postRateData, error: postRateErr } = await adminClient.rpc(
        'evaluate_login_rate_limit_internal',
        {
          p_ip_hash: ipHash,
          p_identifier_hash: identifierHash,
          p_increment: true,
        }
      );

      await applyMinimumFailureTimingFloor(startedAt);

      // SEC-008: Failed-attempt recording MUST also fail closed (never silently return 401)
      if (postRateErr || !isValidRateLimitPayload(postRateData)) {
        console.error('[auth-login] Rate-limit failure recording failed closed.', {
          reason: postRateErr ? 'rpc_error' : 'invalid_payload',
          code: postRateErr?.code || 'INVALID_PAYLOAD',
        });
        return jsonResponse(
          originPolicy.corsHeaders,
          503,
          { ok: false, error: SERVICE_UNAVAILABLE_ERROR },
          { 'Retry-After': '60' }
        );
      }

      if (postRateData.allowed === false) {
        const retryAfter = Math.max(60, Math.ceil(postRateData.retry_after_seconds || 900));
        return jsonResponse(
          originPolicy.corsHeaders,
          429,
          {
            ok: false,
            error: 'Too many sign-in attempts. Please wait before trying again.',
          },
          { 'Retry-After': String(retryAfter) }
        );
      }

      return jsonResponse(originPolicy.corsHeaders, 401, {
        ok: false,
        error: UNIFORM_AUTH_ERROR,
      });
    };

    // 2. Server-only parameterized identifier resolution (active accounts only)
    const { data: resolvedEmail, error: resolveErr } = await adminClient.rpc(
      'resolve_login_identifier',
      { p_identifier: cleanIdentifier }
    );

    if (resolveErr) {
      console.error('[auth-login] Identifier resolution failed closed.', {
        code: resolveErr.code || 'RPC_ERROR',
      });
      await applyMinimumFailureTimingFloor(startedAt);
      return jsonResponse(
        originPolicy.corsHeaders,
        503,
        { ok: false, error: SERVICE_UNAVAILABLE_ERROR },
        { 'Retry-After': '60' }
      );
    }

    if (typeof resolvedEmail !== 'string' || !resolvedEmail.trim()) {
      // Unknown username/email OR inactive account -> uniform 401 with timing floor
      return await recordFailedAttemptAndRespond();
    }

    // 3. Authenticate credentials via stateless anon Supabase Auth client
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: signInData, error: signInErr } = await authClient.auth.signInWithPassword({
      email: resolvedEmail.trim(),
      password,
    });

    if (signInErr || !signInData?.session || !signInData?.user) {
      return await recordFailedAttemptAndRespond();
    }

    // Note: Successful logins intentionally do NOT reset rate-limit counters so
    // an attacker cannot clear IP failure buckets by authenticating to a dummy account.
    return jsonResponse(originPolicy.corsHeaders, 200, {
      ok: true,
      session: {
        access_token: signInData.session.access_token,
        refresh_token: signInData.session.refresh_token,
      },
    });
  } catch {
    console.error('[auth-login] Unexpected operational error during authentication.');
    return jsonResponse(
      originPolicy.corsHeaders,
      503,
      { ok: false, error: SERVICE_UNAVAILABLE_ERROR },
      { 'Retry-After': '60' }
    );
  }
});
