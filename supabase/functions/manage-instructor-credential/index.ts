// Draft server-only instructor credential management. Reuses the verified provisioning gate.
import { createClient } from 'npm:@supabase/supabase-js@2';
const DEFAULT_PRODUCTION_ORIGINS = ['https://operation-lms.vercel.app'];
const MAX_BODY_BYTES = 32_768;
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_PROVISIONS = 20;

const EMAIL_REGEX =
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
const USERNAME_REGEX = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const INSTRUCTOR_CODE_REGEX = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;
const PHONE_REGEX = /^[+0-9()\-\s]{6,32}$/;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Staging-only, exact Vercel origins. Production keeps its configured CORS policy.
const STAGING_PREVIEW_ORIGINS = [
  'https://gleaming-skyblue-heron-54.hostingersite.com',
  'https://operation-ca6y7khe0-salah-2543.vercel.app',
  'https://operation-lms-git-design-graphite-glass-respo-56f62e-salah-2543.vercel.app',
];

// The live Hostinger URL is allowed only against the actual Production project.
// Do not trust an arbitrary caller Origin or grant wildcard access.
const PRODUCTION_HOSTINGER_ORIGINS = [
  'https://gleaming-skyblue-heron-54.hostingersite.com', // previous deployment origin retained for safe transition
  'https://astute-whitesmoke-guanaco-84.hostingersite.com',
];

function productionHostingerOrigins(): string[] {
  const productionRef = 'wdmlxsgbjkboadkeekdq';
  try {
    const host = new URL(Deno.env.get('SUPABASE_URL') || '').hostname;
    if (host === productionRef + '.supabase.co') return PRODUCTION_HOSTINGER_ORIGINS;
  } catch {
    // No usable project URL: never open CORS to arbitrary origins.
  }
  return Deno.env.get('SUPABASE_PROJECT_REF') === productionRef
    ? PRODUCTION_HOSTINGER_ORIGINS : [];
}

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
    return [...DEFAULT_PRODUCTION_ORIGINS, ...stagingPreviewOrigins(), ...productionHostingerOrigins()];
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
      // Ignore malformed origin entries
    }
  }

  return [...new Set([...(parsed.length > 0 ? parsed : DEFAULT_PRODUCTION_ORIGINS), ...stagingPreviewOrigins(), ...productionHostingerOrigins()])];
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
    // Non-browser / server-to-server requests without Origin: never emit wildcard ACAO
    return {
      allowed: true,
      originHeader: null,
      corsHeaders: {
        'Vary': 'Origin',
      },
    };
  }

  if (!allowedOrigins.includes(origin)) {
    return {
      allowed: false,
      originHeader: origin,
      corsHeaders: {
        'Vary': 'Origin',
      },
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
      'Vary': 'Origin',
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
      'Pragma': 'no-cache',
      ...extraHeaders,
    },
  });
}

function decodeJwtPayload(jwt: string): Record<string, unknown> | null {
  const parts = jwt.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
    const decoded = atob(base64 + pad);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}


function validateInitialPasswordStrength(password: string): string | null {
  const trimmed = password.trim();
  if (trimmed.length < 8) {
    return 'Temporary password must be at least 8 characters long.';
  }
  if (trimmed.length > 128) {
    return 'Temporary password must not exceed 128 characters.';
  }
  if (!/[A-Z]/.test(trimmed) || !/[a-z]/.test(trimmed) || !/\d/.test(trimmed)) {
    return 'Temporary password must include uppercase, lowercase, and at least one number.';
  }
  return null;
}


Deno.serve(async (req: Request) => {
  const allowedOrigins = resolveAllowedOrigins();
  const originPolicy = evaluateOriginPolicy(req, allowedOrigins);

  if (req.method === 'OPTIONS') {
    if (!originPolicy.originHeader || !originPolicy.allowed) {
      return jsonResponse({ 'Vary': 'Origin' }, 403, {
        ok: false,
        error: 'Origin not allowed.',
      });
    }
    return new Response(null, { status: 204, headers: originPolicy.corsHeaders });
  }

  if (!originPolicy.allowed) {
    return jsonResponse({ 'Vary': 'Origin' }, 403, {
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
    console.error('[manage-instructor-credential] Missing required Supabase server environment variables.');
    return jsonResponse(originPolicy.corsHeaders, 500, {
      ok: false,
      error: 'Provisioning service is not configured on the server.',
    });
  }

  // 1. Authenticate caller from Bearer JWT
  const authHeader = req.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    return jsonResponse(originPolicy.corsHeaders, 401, {
      ok: false,
      error: 'Authentication required to manage instructor accounts.',
    });
  }
  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return jsonResponse(originPolicy.corsHeaders, 401, {
      ok: false,
      error: 'Authentication token is missing.',
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const {
    data: { user: callerUser },
    error: callerErr,
  } = await userClient.auth.getUser(token);

  if (callerErr || !callerUser) {
    return jsonResponse(originPolicy.corsHeaders, 401, {
      ok: false,
      error: 'Invalid or expired authentication session.',
    });
  }

  // 2. Verify authenticated session and subject binding from verified JWT payload
  const jwtPayload = decodeJwtPayload(token);
  const jwtSub = typeof jwtPayload?.sub === 'string' ? jwtPayload.sub : null;
  const jwtAal = typeof jwtPayload?.aal === 'string' ? jwtPayload.aal : null;
  if (!jwtSub || jwtSub !== callerUser.id) {
    return jsonResponse(originPolicy.corsHeaders, 401, {
      ok: false,
      error: 'Authentication token subject mismatch.',
    });
  }
  if (jwtAal !== 'aal1' && jwtAal !== 'aal2') {
    return jsonResponse(originPolicy.corsHeaders, 403, {
      ok: false,
      error: 'An authenticated admin session is required.',
    });
  }

  // 3. Server-side privileged client (never exposed to browser)
  const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 4. Verify caller is an active Admin with a valid admin_accounts slot (1 or 2)
  const [{ data: callerProfile, error: profLookupErr }, { data: callerAdmin, error: adminLookupErr }] =
    await Promise.all([
      adminClient
        .from('profiles')
        .select('id, role, is_active, must_change_password, full_name_en')
        .eq('id', callerUser.id)
        .maybeSingle(),
      adminClient
        .from('admin_accounts')
        .select('id, profile_id, assigned_slot')
        .eq('profile_id', callerUser.id)
        .maybeSingle(),
    ]);

  if (profLookupErr || adminLookupErr) {
    console.error('[manage-instructor-credential] Failed verifying caller admin record.');
    return jsonResponse(originPolicy.corsHeaders, 500, {
      ok: false,
      error: 'Unable to verify administrator authorization.',
    });
  }

  if (
    !callerProfile ||
    !callerProfile.is_active ||
    callerProfile.must_change_password ||
    callerProfile.role !== 'admin' ||
    !callerAdmin ||
    (callerAdmin.assigned_slot !== 1 && callerAdmin.assigned_slot !== 2)
  ) {
    return jsonResponse(originPolicy.corsHeaders, 403, {
      ok: false,
      error: 'Forbidden: Only active authorized CITS Administrators can manage instructors.',
    });
  }


  const reply=(status:number,error:string)=>jsonResponse(originPolicy.corsHeaders,status,{ok:false,error});
  let body: Record<string,unknown>;
  try {
    const raw=await req.text();
    if(new TextEncoder().encode(raw).length>MAX_BODY_BYTES)return reply(400,'Payload too large.');
    const parsed=JSON.parse(raw);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return reply(400,'Invalid request.');
    body=parsed;
  } catch {return reply(400,'Invalid request.');}
  if(Object.keys(body).some(k=>!['instructorId','action','value'].includes(k)))return reply(400,'Invalid fields.');
  const id=typeof body.instructorId==='string'?body.instructorId:'';
  const action=body.action;
  const value=typeof body.value==='string'?body.value.trim():'';
  if(!UUID_REGEX.test(id)||(action!=='email' && action!=='temporary_credential'))return reply(400,'Invalid instructor or action.');
  if(action==='email'&&(!EMAIL_REGEX.test(value)||value.length>254))return reply(400,'Invalid email.');
  if(action==='temporary_credential'&&validateInitialPasswordStrength(value))return reply(400,'Use a strong password of 8–128 characters with uppercase, lowercase and digits.');

  const {data:target,error:targetErr}=await adminClient.from('instructors').select('id,profile_id').eq('id',id).maybeSingle();
  if(targetErr||!target)return reply(404,'Instructor not found.');
  const {data:profile,error:profileErr}=await adminClient.from('profiles').select('id,role,email,must_change_password').eq('id',target.profile_id).eq('role','instructor').maybeSingle();
  if(profileErr||!profile||profile.id===callerUser.id)return reply(403,'Invalid instructor account.');
  const {data:authTarget,error:authErr}=await adminClient.auth.admin.getUserById(profile.id);
  if(authErr||!authTarget.user||authTarget.user.email?.toLowerCase()!==profile.email?.toLowerCase())return reply(409,'Account identity is inconsistent; manual reconciliation required.');

  const actionName=action==='email'?'INSTRUCTOR_LOGIN_EMAIL_CHANGED':'INSTRUCTOR_CREDENTIAL_ROTATED';
  const since=new Date(Date.now()-RATE_LIMIT_WINDOW_MINUTES*60*1000).toISOString();
  const {count,error:rateErr}=await adminClient.from('audit_logs').select('id',{count:'exact',head:true}).eq('actor_profile_id',callerProfile.id).in('action',['INSTRUCTOR_LOGIN_EMAIL_CHANGED','INSTRUCTOR_CREDENTIAL_ROTATED','INSTRUCTOR_CREDENTIAL_CHANGE_REQUESTED']).gte('created_at',since);
  if(rateErr)return reply(500,'Could not verify account change rate limit.');
  if((count??0)>=RATE_LIMIT_MAX_PROVISIONS)return reply(429,'Too many account changes. Try later.');
  const audit=async (event:string)=>adminClient.from('audit_logs').insert({
    actor_profile_id:callerProfile.id,actor_name:callerProfile.full_name_en,actor_role:'admin',
    camp_id:null,action:event,entity_type:'instructors',entity_id:id,
    previous_value:null,new_value:{profile_id:profile.id,operation:action==='email'?'email_change':'credential_rotation'},
    reason:'Admin requested instructor account maintenance',
  });
  const auditStart=await audit('INSTRUCTOR_CREDENTIAL_CHANGE_REQUESTED');
  if(auditStart.error)return reply(500,'Could not record account change request.');
  if(action==='email'){
    const email=value.toLowerCase();
    if(email!==profile.email.toLowerCase()){
      // Compare-and-set profile, then Auth; compensate if Auth rejects the change.
      const profileWrite=await adminClient.from('profiles').update({email}).eq('id',profile.id).eq('email',profile.email).eq('role','instructor').select('id').single();
      if(profileWrite.error)return reply(409,'Email already used or account changed. Refresh and retry.');
      const changed=await adminClient.auth.admin.updateUserById(profile.id,{email,email_confirm:true});
      if(changed.error){
        const rollback=await adminClient.from('profiles').update({email:profile.email}).eq('id',profile.id).eq('email',email).select('id').single();
        return reply(rollback.error?500:409,rollback.error?'Account identity needs reconciliation; contact administrator.':'Email update rejected; prior profile email restored.');
      }
    }
  }else{
    // Force rotation before setting the temporary credential; fail closed if Auth fails.
    const flag=await adminClient.from('profiles').update({must_change_password:true}).eq('id',profile.id).eq('role','instructor').select('id').single();
    if(flag.error)return reply(500,'Could not enforce password rotation.');
    const changed=await adminClient.auth.admin.updateUserById(profile.id,{password:value});
    if(changed.error)return reply(409,'Temporary credential update rejected. Rotation requirement retained for safety.');
  }
  const done=await audit(actionName);
  if(done.error)return reply(500,'Account changed but final audit failed. Refresh and verify before retrying.');
  return jsonResponse(originPolicy.corsHeaders,200,{ok:true});
});
