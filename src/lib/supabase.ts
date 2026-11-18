import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../types/database';

export const CITS_SUPABASE_PROJECT_NAME = 'cits-camp-operations';
export const CITS_SUPABASE_PROJECT_REF = 'wdmlxsgbjkboadkeekdq';
export const CITS_SUPABASE_PROJECT_URL = 'https://wdmlxsgbjkboadkeekdq.supabase.co';

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
const supabaseUrl = (metaEnv.VITE_SUPABASE_URL || CITS_SUPABASE_PROJECT_URL).trim();
const supabaseAnonKey = (metaEnv.VITE_SUPABASE_ANON_KEY || '').trim();

function containsServiceRoleJwtPayload(key: string): boolean {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded =
      typeof atob === 'function'
        ? atob(base64)
        : Buffer.from(base64, 'base64').toString('utf8');
    return decoded.toLowerCase().includes('"service_role"');
  } catch {
    return false;
  }
}

/**
 * Validate environment variables for security and configuration correctness.
 * Blocks accidental exposure of secret/service-role keys in VITE_ variables.
 */
export function validateSupabaseEnvConfig(url: string, key: string): {
  isConfigured: boolean;
  mode: 'connected_supabase_configured' | 'local_sandbox_mode' | 'security_error';
  setupError: string | null;
} {
  if (!url && !key) {
    return {
      isConfigured: false,
      mode: 'local_sandbox_mode',
      setupError:
        'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set. Running in Local Operational Sandbox mode (remote Supabase database is NOT connected).',
    };
  }

  if (!url || !key) {
    return {
      isConfigured: false,
      mode: 'local_sandbox_mode',
      setupError:
        `Target project ${CITS_SUPABASE_PROJECT_NAME} (${CITS_SUPABASE_PROJECT_URL}) is configured, but VITE_SUPABASE_ANON_KEY is not set in environment variables. Running in Local Operational Sandbox mode until the public anon/publishable key is provided.`,
    };
  }

  if (!url.startsWith('https://') || url.includes('YOUR_PROJECT') || url.includes('<your-project')) {
    return {
      isConfigured: false,
      mode: 'local_sandbox_mode',
      setupError:
        'Invalid VITE_SUPABASE_URL: must be a valid https://<project-ref>.supabase.co URL.',
    };
  }

  // Security check: Never allow a Supabase Secret Key (sb_secret_...) or service_role JWT in frontend
  if (
    key.startsWith('sb_secret_') ||
    key.toLowerCase().includes('service_role') ||
    containsServiceRoleJwtPayload(key)
  ) {
    return {
      isConfigured: false,
      mode: 'security_error',
      setupError:
        'CRITICAL SECURITY VIOLATION: A secret or service-role key was detected in VITE_SUPABASE_ANON_KEY. Use only the public anon or sb_publishable_ key in frontend variables.',
    };
  }

  return {
    isConfigured: true,
    mode: 'connected_supabase_configured',
    setupError: null,
  };
}

const envValidation = validateSupabaseEnvConfig(supabaseUrl, supabaseAnonKey);

export const isSupabaseConfigured = envValidation.isConfigured;

/**
 * Typed Supabase client initialized strictly with the public anon / publishable key.
 * Row Level Security (RLS) policies on PostgreSQL enforce Admin vs Instructor isolation.
 */
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null;

export function getSupabaseStatusSummary() {
  let urlHost = `${CITS_SUPABASE_PROJECT_URL} (Local Sandbox Fallback — Public Anon Key Pending)`;
  if (isSupabaseConfigured) {
    try {
      urlHost = new URL(supabaseUrl).host;
    } catch {
      urlHost = 'Invalid URL';
    }
  }
  const message =
    envValidation.setupError ||
    `Connected Supabase credentials configured for ${urlHost} with public anon key and PostgreSQL RLS active.`;
  return {
    projectName: CITS_SUPABASE_PROJECT_NAME,
    projectRef: CITS_SUPABASE_PROJECT_REF,
    projectUrl: CITS_SUPABASE_PROJECT_URL,
    configured: isSupabaseConfigured,
    mode: envValidation.mode,
    setupError: envValidation.setupError,
    message,
    urlHost,
    rlsEnabled: true,
    freeTierGuardActive: true,
  };
}
