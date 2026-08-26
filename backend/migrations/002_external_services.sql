-- Path+ External Services Configuration
-- Additive only. Secrets are stored encrypted (AES-256-GCM) by the backend.
-- NEVER expose encrypted_secrets or decrypted values to clients / anon key.
-- Run against Supabase Postgres (SQL Editor or psql).

-- ---------------------------------------------------------------------------
-- External service settings
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.external_service_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service TEXT NOT NULL UNIQUE CHECK (service IN (
    'email',
    'supabase',
    'push',
    'google_places'
  )),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  -- Non-secret configuration (JSON). Never store API keys / passwords here.
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Encrypted secrets blob (ciphertext only). Opaque to clients.
  encrypted_secrets TEXT,
  -- Which secret fields are present (e.g. ["apiKey"]) — never the values.
  secret_fields TEXT[] NOT NULL DEFAULT '{}',
  last_test_at TIMESTAMPTZ,
  last_test_ok BOOLEAN,
  last_test_message TEXT,
  updated_by UUID REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_external_service_settings_service
  ON public.external_service_settings (service);

-- Seed default rows (configuration only — no secrets)
INSERT INTO public.external_service_settings (service, enabled, configuration) VALUES
  (
    'email',
    TRUE,
    '{
      "provider": "resend",
      "fromEmail": "",
      "fromName": "Path+",
      "replyTo": "",
      "publicAppUrl": "",
      "templates": {
        "signupOtp": {
          "subject": "Your verification code",
          "enabled": true
        },
        "passwordResetOtp": {
          "subject": "Your Path+ password reset code",
          "enabled": true
        },
        "accountDeletion": {
          "subject": "Your Path+ account is suspended for 30 days",
          "enabled": true
        }
      }
    }'::jsonb
  ),
  (
    'supabase',
    TRUE,
    '{
      "notes": "URL and anon key remain server env / public client config. Service role key is server-only."
    }'::jsonb
  ),
  (
    'push',
    TRUE,
    '{
      "provider": "expo",
      "notes": "Expo Push API — no server API secret required for basic send."
    }'::jsonb
  ),
  (
    'google_places',
    TRUE,
    '{
      "notes": "Server-side Places Nearby Search key. Mobile may use a separate restricted client key."
    }'::jsonb
  )
ON CONFLICT (service) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS: no public policies — only service_role / postgres can access
-- ---------------------------------------------------------------------------
ALTER TABLE public.external_service_settings ENABLE ROW LEVEL SECURITY;

-- Explicit deny for authenticated/anon (defense in depth; service_role bypasses RLS)
DROP POLICY IF EXISTS external_service_settings_deny_all ON public.external_service_settings;
-- No SELECT/INSERT/UPDATE/DELETE policies for anon/authenticated → blocked by default.
