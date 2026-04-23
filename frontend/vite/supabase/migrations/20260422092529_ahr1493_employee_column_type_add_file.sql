-- ============================================
-- AHR-1493 — add 'file' to employee_column_type ENUM
-- File columns store `files.id` (TEXT) on employees.{col_xxx}.
-- Cell renders filename + download icon via signed URL from the Worker.
-- ============================================

ALTER TYPE employee_column_type ADD VALUE 'file';
