import { createClient, SupabaseClient } from '@supabase/supabase-js';

function sanitizeEnvValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  let trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeSupabaseUrl(raw: string): string {
  const cleaned = raw.replace(/\/+$/, '');
  if (!cleaned) return '';
  if (/^[a-z0-9-]+\.supabase\.co$/i.test(cleaned)) {
    return `https://${cleaned}`;
  }
  return cleaned;
}

function isValidHttpUrl(value: string): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

// Read directly from import.meta.env so Vite statically replaces both variables at build time
const envUrl = import.meta.env.VITE_SUPABASE_URL;
const envAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

const rawUrl = sanitizeEnvValue(envUrl);
const supabaseUrl = normalizeSupabaseUrl(rawUrl);
const supabaseAnonKey = sanitizeEnvValue(envAnonKey);

const hasValidUrl = isValidHttpUrl(supabaseUrl);
const hasAnonKey = supabaseAnonKey.length > 0;

export const isSupabaseConfigured = hasValidUrl && hasAnonKey;

let fallbackReason: string | undefined;
if (!isSupabaseConfigured) {
  if (!rawUrl && !hasAnonKey) {
    fallbackReason =
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are empty or not injected at build time';
  } else if (!rawUrl) {
    fallbackReason = 'VITE_SUPABASE_URL is missing';
  } else if (!hasValidUrl) {
    fallbackReason = `VITE_SUPABASE_URL ("${rawUrl}") is not a valid http(s) URL (expected https://<project-ref>.supabase.co)`;
  } else {
    fallbackReason = 'VITE_SUPABASE_ANON_KEY is missing';
  }
}

export const supabaseConnectionInfo = {
  configured: isSupabaseConfigured,
  url: supabaseUrl,
  reason: fallbackReason,
};

if (isSupabaseConfigured) {
  console.info(
    `[ClearLedger] Supabase connected — using remote database at ${supabaseUrl} (VITE_SUPABASE_URL & VITE_SUPABASE_ANON_KEY detected).`
  );
} else {
  console.warn(
    `[ClearLedger] Supabase not configured (${fallbackReason}) — falling back to localStorage. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set for this environment and redeploy.`
  );
}

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      realtime: {
        params: {
          eventsPerSecond: 10,
        },
      },
    })
  : null;
