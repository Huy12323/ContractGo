-- ============================================
-- AHR-1705: Add thumbnail_r2_key to public.files
-- ============================================
-- Design intent (see Outline d/d1813dac-0177-4ea5-88a1-88ed88969bff):
--
--   * Separate pointer for the thumbnail file in R2, so thumbnail generation
--     is independent of the original upload. Failed thumbnail generation
--     leaves the column NULL and the attachment strip UI falls back to a
--     generic file icon.
--
--   * Nullable, no default — existing rows stay NULL. Upstream upload hook
--     (useM_Files_Upload) will be extended in AHR-1711 to populate this when
--     a thumbnail is produced (image client-side, docs via microservice).
-- ============================================

ALTER TABLE public.files
    ADD COLUMN thumbnail_r2_key TEXT;
