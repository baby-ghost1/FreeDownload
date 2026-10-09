-- Backfill the two download-source rows the admin console and policy engine
-- read. The deploy pipeline runs migrations but never `db:seed`, so databases
-- provisioned before cobalt existed (seed commit b38fc3e) kept only the
-- `generic` row - the deployed Sources tab showed yt-dlp alone.
--
-- ON CONFLICT DO NOTHING: re-running seed (upsert) or a restore that already
-- has these rows must never clobber an admin's enabled/mode/health edits.
INSERT INTO "download_sources" (
  "id",
  "slug",
  "name",
  "adapter_key",
  "enabled",
  "mode",
  "allowed_formats",
  "max_file_size_mb",
  "requires_auth",
  "allowed_features",
  "priority",
  "health_status",
  "policy_version"
) VALUES
  (
    gen_random_uuid(),
    'generic',
    'Generic (yt-dlp)',
    'ytdlp',
    true,
    'active',
    '["video", "audio", "mp4", "webm", "mp3", "m4a"]'::jsonb,
    4096,
    false,
    '["metadata", "formats"]'::jsonb,
    100,
    'unknown',
    1
  ),
  (
    gen_random_uuid(),
    'cobalt',
    'Cobalt (fallback)',
    'cobalt',
    true,
    'active',
    '["video", "audio", "mp4", "webm", "mp3", "m4a"]'::jsonb,
    4096,
    false,
    '["metadata", "formats"]'::jsonb,
    200,
    'unknown',
    1
  )
ON CONFLICT ("slug") DO NOTHING;
