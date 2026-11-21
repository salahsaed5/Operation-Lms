import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../types/database';

export const CITS_SUPABASE_PROJECT_NAME = 'cits-camp-operations';
export const CITS_SUPABASE_PROJECT_REF = 'wdmlxsgbjkboadkeekdq';
export const CITS_SUPABASE_PROJECT_URL = 'https://wdmlxsgbjkboadkeekdq.supabase.co';

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env || {};
const isDevelopmentBuild = import.meta.env.DEV;
// Never infer or default to Production. Every connected environment must name its target.
const supabaseUrl = (metaEnv.VITE_SUPABASE_URL || '').trim();
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
export function validateSupabaseEnvConfig(url: string, key: string, allowLocalSandbox = true): {
  isConfigured: boolean;
  mode: 'connected_supabase_configured' | 'local_sandbox_mode' | 'security_error';
  setupError: string | null;
} {
  const invalidConfigurationMode = allowLocalSandbox ? 'local_sandbox_mode' : 'security_error';
  const missingVariables = [
    ...(url ? [] : ['VITE_SUPABASE_URL']),
    ...(key ? [] : ['VITE_SUPABASE_ANON_KEY']),
  ];

  if (missingVariables.length > 0) {
    return {
      isConfigured: false,
      mode: invalidConfigurationMode,
      setupError: allowLocalSandbox
        ? `Missing ${missingVariables.join(' and ')}. Running in Local Operational Sandbox mode; remote Supabase is NOT connected.`
        : `Deployment blocked: ${missingVariables.join(' and ')} must be explicitly configured. Local Sandbox access is disabled outside development builds.`,
    };
  }

  if (!url.startsWith('https://') || url.includes('YOUR_PROJECT') || url.includes('<your-project')) {
    return {
      isConfigured: false,
      mode: invalidConfigurationMode,
      setupError: allowLocalSandbox
        ? 'Invalid VITE_SUPABASE_URL: must be a valid https://<project-ref>.supabase.co URL. Local Sandbox mode is active; remote Supabase is not connected.'
        : 'Deployment blocked: VITE_SUPABASE_URL must be a valid https://<project-ref>.supabase.co URL.',
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

const envValidation = validateSupabaseEnvConfig(supabaseUrl, supabaseAnonKey, isDevelopmentBuild);

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
