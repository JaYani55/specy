ALTER TABLE IF EXISTS public.plugins
  ADD COLUMN IF NOT EXISTS config_schema JSONB NOT NULL DEFAULT '[]';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plugins_config_is_object'
  ) THEN
    ALTER TABLE public.plugins
      ADD CONSTRAINT plugins_config_is_object
      CHECK (jsonb_typeof(config) = 'object');
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'plugins_config_schema_is_array'
  ) THEN
    ALTER TABLE public.plugins
      ADD CONSTRAINT plugins_config_schema_is_array
      CHECK (jsonb_typeof(config_schema) = 'array');
  END IF;
END $$;