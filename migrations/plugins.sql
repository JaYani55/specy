-- ============================================================
-- Plugin Registry
-- Stores records of plugins registered/installed in this CMS.
-- Installation itself is performed by scripts/install-plugins.mjs
-- (GitHub ZIP download → src/plugins/{slug}/ → registry rebuild).
-- ============================================================

CREATE TABLE public.plugins (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug             VARCHAR(100) UNIQUE NOT NULL,
  name             VARCHAR(255) NOT NULL,
  version          VARCHAR(50)  NOT NULL DEFAULT '0.0.0',
  description      TEXT,
  author_name      VARCHAR(255),
  author_url       VARCHAR(500),
  license          VARCHAR(100),
  repo_url         VARCHAR(500) NOT NULL,
  download_url     VARCHAR(500),              -- optional override (e.g. private CDN)
  status           VARCHAR(50)  NOT NULL DEFAULT 'registered'
                     CHECK (status IN ('registered', 'installed', 'enabled', 'disabled', 'error')),
  config           JSONB        NOT NULL DEFAULT '{}',
  error_message    TEXT,                      -- populated when status = 'error'
  installed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Index for fast lookups by slug and status
CREATE INDEX idx_plugins_slug   ON public.plugins (slug);
CREATE INDEX idx_plugins_status ON public.plugins (status);

-- Auto-update updated_at on every write
CREATE TRIGGER trg_plugins_updated_at
  BEFORE UPDATE ON public.plugins
  FOR EACH ROW EXECUTE FUNCTION public.set_current_timestamp_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================
ALTER TABLE public.plugins ENABLE ROW LEVEL SECURITY;

-- Any authenticated user can read the plugin registry
CREATE POLICY "authenticated_select_plugins"
  ON public.plugins
  FOR SELECT
  TO authenticated
  USING (TRUE);

-- Only admins (SUPERADMIN) can create plugin records
CREATE POLICY "admin_insert_plugins"
  ON public.plugins
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.jwt() -> 'user_roles') @> '["admin"]'::jsonb
    OR (auth.jwt() -> 'user_roles') @> '["super-admin"]'::jsonb
  );

-- Only admins can update plugin records (status, config, etc.)
CREATE POLICY "admin_update_plugins"
  ON public.plugins
  FOR UPDATE
  TO authenticated
  USING (
    (auth.jwt() -> 'user_roles') @> '["admin"]'::jsonb
    OR (auth.jwt() -> 'user_roles') @> '["super-admin"]'::jsonb
  );

-- Only admins can delete plugin records
CREATE POLICY "admin_delete_plugins"
  ON public.plugins
  FOR DELETE
  TO authenticated
  USING (
    (auth.jwt() -> 'user_roles') @> '["admin"]'::jsonb
    OR (auth.jwt() -> 'user_roles') @> '["super-admin"]'::jsonb
  );
