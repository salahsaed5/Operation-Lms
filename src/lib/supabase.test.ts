import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSupabaseEnvConfig } from './supabase';

test('local sandbox is permitted only when the caller explicitly allows development fallback', () => {
  const result = validateSupabaseEnvConfig('', '', true);
  assert.equal(result.isConfigured, false);
  assert.equal(result.mode, 'local_sandbox_mode');
  assert.match(result.setupError || '', /remote Supabase database is NOT connected/i);
});

test('missing Supabase configuration fails closed outside development', () => {
  const result = validateSupabaseEnvConfig('', '', false);
  assert.equal(result.isConfigured, false);
  assert.equal(result.mode, 'security_error');
  assert.match(result.setupError || '', /disabled outside development builds/i);
});

test('partial Supabase configuration fails closed outside development', () => {
  const result = validateSupabaseEnvConfig('https://staging-ref.supabase.co', '', false);
  assert.equal(result.isConfigured, false);
  assert.equal(result.mode, 'security_error');
  assert.match(result.setupError || '', /both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are required/i);
});

test('valid public Supabase credentials are accepted', () => {
  const result = validateSupabaseEnvConfig(
    'https://staging-ref.supabase.co',
    'public-anon-key',
    false
  );
  assert.equal(result.isConfigured, true);
  assert.equal(result.mode, 'connected_supabase_configured');
  assert.equal(result.setupError, null);
});

test('service-role or secret keys are rejected in frontend configuration', () => {
  const result = validateSupabaseEnvConfig(
    'https://staging-ref.supabase.co',
    'sb_secret_do_not_expose',
    false
  );
  assert.equal(result.isConfigured, false);
  assert.equal(result.mode, 'security_error');
  assert.match(result.setupError || '', /CRITICAL SECURITY VIOLATION/i);
});
