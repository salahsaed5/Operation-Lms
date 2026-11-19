// =============================================================================
// Supabase Edge Function: auth-login
// Security Phase Closure — SEC-004 Non-Enumerable, Rate-Limited Login Gateway
//
// Security Model:
// - Replaces direct anon client calls to resolve_login_identifier(TEXT) so
//   unauthenticated callers can NEVER enumerate active usernames or resolve
//   usernames to user email addresses.
// - Explicit CORS allowlist (ALLOWED_ORIGINS, defaults to
//   https://operation-lms.vercel.app; NEVER wildcard '*' and NEVER arbitrary
//   origin reflection). Unauthorized origins receive HTTP 403.
// - Distributed PostgreSQL-backed sliding-window rate limiting via
//   cits_internal.auth_login_rate_limits (SHA-256 hashed IP & identifier keys;
//   10 failed attempts / 15 min per identifier, 25 / 15 min per IP -> HTTP 429).
// - Uniform non-enumerable HTTP 401 error ('Invalid credentials or account
//   unavailable.') across unknown username, unknown email, inactive account,
//   and wrong password, paired with a minimum response timing floor to reduce
//   timing side-channels.
// - Never returns resolved email on failure, never logs passwords, JWTs,
//   refresh tokens, or SUPABASE_SERVICE_ROLE_KEY, and sets Cache-Control: no-store.
// =============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

interface LoginRequestBody {
  identifier?: string;
  password?: string;
}

const DEFAULT_PRODUCTION_ORIGINS = ['https://operation-lms.vercel.app'];
const MAX_BODY_BYTES = 8_192;
const UNIFORM_AUTH_ERROR = 'Invalid credentials or account unavailable.';
const MIN_AUTH_RESPONSE_MS = 250;

function resolveAllowedOrigins(): string[] {
  const raw = (Deno.env.get('ALLOWED_ORIGINS') || '').trim();
  if (!raw) {
    return [...DEFAULT_PRODUCTION_ORIGINS];
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

  return parsed.length > 0 ? parsed : [...DEFAULT_PRODUCTION_ORIGINS];
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

function extractClientIp(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  const realIp = req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip');
  if (realIp) return realIp.trim().slice(0, 64);
  return 'unknown';
}

async function applyMinimumResponseFloor(startedAt: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  const remaining = MIN_AUTH_RESPONSE_MS - elapsed;
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();
  const allowedOrigins = resolveAllowedOrigins();
  const originPolicy = evaluateOriginPolicy(req, allowedOrigins);

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
      return jsonResponse(originPolicy.corsHeaders, 400, {
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
    return jsonResponse(originPolicy.corsHeaders, 500, {
      ok: false,
      error: 'Authentication service is not configured on the server.',
    });
  }

  let rawText = '';
  try {
    rawText = await req.text();
  } catch {
    return jsonResponse(originPolicy.corsHeaders, 400, {
      ok: false,
      error: 'Unable to read request body.',
    });
  }

  if (rawText.length > MAX_BODY_BYTES) {
    return jsonResponse(originPolicy.corsHeaders, 400, {
      ok: false,
      error: 'Request payload exceeds maximum allowed size.',
    });
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawText);
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
  const cleanIdentifier = typeof body.identifier === 'string' ? body.identifier.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!cleanIdentifier || cleanIdentifier.length > 120 || !password || password.length > 256) {
    return jsonResponse(originPolicy.corsHeaders, 400, {
      ok: false,
      error: 'Username/email and password are required.',
    });
  }

  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const clientIp = extractClientIp(req);
  const [ipHash, identifierHash] = await Promise.all([
    sha256Hex(`ip:${clientIp}`),
    sha256Hex(`id:${cleanIdentifier}`),
  ]);

  // 1. Pre-auth distributed rate-limit check (fails closed on excessive attempts)
  const { data: preRateData, error: preRateErr } = await adminClient.rpc(
    'evaluate_login_rate_limit_internal',
    {
      p_ip_hash: ipHash,
      p_identifier_hash: identifierHash,
      p_increment: false,
    }
  );

  if (
    !preRateErr &&
    preRateData &&
    typeof preRateData === 'object' &&
    (preRateData as { allowed?: boolean }).allowed === false
  ) {
    const retryAfter = Math.max(
      60,
      Number((preRateData as { retry_after_seconds?: number }).retry_after_seconds || 900)
    );
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
    const { data: postRateData } = await adminClient.rpc('evaluate_login_rate_limit_internal', {
      p_ip_hash: ipHash,
      p_identifier_hash: identifierHash,
      p_increment: true,
    });
    await applyMinimumResponseFloor(startedAt);

    if (
      postRateData &&
      typeof postRateData === 'object' &&
      (postRateData as { allowed?: boolean }).allowed === false
    ) {
      const retryAfter = Math.max(
        60,
        Number((postRateData as { retry_after_seconds?: number }).retry_after_seconds || 900)
      );
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
    console.error('[auth-login] Identifier resolution query error.');
    await applyMinimumResponseFloor(startedAt);
    return jsonResponse(originPolicy.corsHeaders, 500, {
      ok: false,
      error: 'Authentication service encountered an error. Please try again.',
    });
  }

  if (typeof resolvedEmail !== 'string' || !resolvedEmail.trim()) {
    // Unknown username/email OR inactive account -> uniform 401 with minimum timing floor
    return await recordFailedAttemptAndRespond();
  }

  // 3. Authenticate credentials via Supabase Auth (anon client, zero session persistence)
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

  return jsonResponse(originPolicy.corsHeaders, 200, {
    ok: true,
    session: {
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    },
  });
});
