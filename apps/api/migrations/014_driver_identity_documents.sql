ALTER TABLE driver_documents
  ADD COLUMN IF NOT EXISTS file_data bytea,
  ADD COLUMN IF NOT EXISTS file_mime text;

DELETE FROM driver_documents older
USING driver_documents newer
WHERE older.driver_id = newer.driver_id
  AND older.document_type = newer.document_type
  AND (older.created_at < newer.created_at
    OR (older.created_at = newer.created_at AND older.id::text < newer.id::text));

CREATE UNIQUE INDEX IF NOT EXISTS driver_documents_type_unique
  ON driver_documents(driver_id, document_type);

ALTER TABLE driver_documents
  DROP CONSTRAINT IF EXISTS driver_documents_file_mime_check;

ALTER TABLE driver_documents
  ADD CONSTRAINT driver_documents_file_mime_check
  CHECK (file_mime IS NULL OR file_mime IN ('image/jpeg', 'image/png', 'image/webp'));
