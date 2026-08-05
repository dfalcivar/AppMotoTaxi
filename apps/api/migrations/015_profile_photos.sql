ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_photo_data bytea,
  ADD COLUMN IF NOT EXISTS profile_photo_mime text,
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at timestamptz;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_profile_photo_mime_check;
ALTER TABLE users ADD CONSTRAINT users_profile_photo_mime_check
  CHECK (profile_photo_mime IS NULL OR profile_photo_mime IN
    ('image/jpeg', 'image/png', 'image/webp'));

UPDATE users u
SET profile_photo_data = photo.file_data,
    profile_photo_mime = photo.file_mime,
    profile_photo_updated_at = photo.created_at
FROM driver_documents photo
WHERE photo.driver_id = u.id
  AND photo.document_type = 'PROFILE_PHOTO'
  AND photo.file_data IS NOT NULL
  AND u.profile_photo_data IS NULL;
