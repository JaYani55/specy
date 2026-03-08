-- storage.default.sql  — TEMPLATE — do not run this file directly.
--
-- During  npm run setup  (Supabase storage provider only), scripts/setup.mjs
-- reads this template, replaces every occurrence of REPLACE_WITH_STORAGE_BUCKET
-- with the bucket name chosen by the user, and applies the resulting SQL via
-- the Supabase Management API.
--
-- When STORAGE_PROVIDER = 'r2' this file is skipped entirely — Cloudflare R2
-- manages its own permissions and does not use Supabase Storage RLS.
--
-- All statements are idempotent (safe to re-run).
--
-- NOTE: Bucket creation itself is handled by the auto-create logic in
-- api/routes/media.ts (requires the service role key) or via the Supabase
-- dashboard.  These policies control row-level access on storage.objects.
--
-- Upload / delete / bucket management from the Cloudflare Worker use the
-- service role key (createSupabaseAdminClient) which bypasses RLS entirely.
-- The policies below cover direct browser access and are a defence-in-depth
-- measure for any future browser-side operations.

-- ── REPLACE_WITH_STORAGE_BUCKET bucket ───────────────────────────────────────

-- 1. Public read: anyone may download files from this bucket.
DROP POLICY IF EXISTS "REPLACE_WITH_STORAGE_BUCKET: public read" ON storage.objects;
CREATE POLICY "REPLACE_WITH_STORAGE_BUCKET: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'REPLACE_WITH_STORAGE_BUCKET');

-- 2. Authenticated insert: logged-in users may upload files.
DROP POLICY IF EXISTS "REPLACE_WITH_STORAGE_BUCKET: authenticated insert" ON storage.objects;
CREATE POLICY "REPLACE_WITH_STORAGE_BUCKET: authenticated insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'REPLACE_WITH_STORAGE_BUCKET'
    AND auth.role() IN ('authenticated', 'service_role')
  );

-- 3. Authenticated update: allow upsert (overwrite existing files).
DROP POLICY IF EXISTS "REPLACE_WITH_STORAGE_BUCKET: authenticated update" ON storage.objects;
CREATE POLICY "REPLACE_WITH_STORAGE_BUCKET: authenticated update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'REPLACE_WITH_STORAGE_BUCKET'
    AND auth.role() IN ('authenticated', 'service_role')
  );

-- 4. Authenticated delete.
DROP POLICY IF EXISTS "REPLACE_WITH_STORAGE_BUCKET: authenticated delete" ON storage.objects;
CREATE POLICY "REPLACE_WITH_STORAGE_BUCKET: authenticated delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'REPLACE_WITH_STORAGE_BUCKET'
    AND auth.role() IN ('authenticated', 'service_role')
  );
