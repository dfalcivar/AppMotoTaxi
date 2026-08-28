-- Only the driver's OPERATING_PERMIT becomes optional. Keep uploaded files,
-- reviews, vehicle requirements, memberships and approval decisions intact.
-- Existing complete submissions must not need another upload to enter review.
UPDATE drivers d
SET approval_status = 'PENDIENTE_REVISION',
    submitted_for_review_at = coalesce(d.submitted_for_review_at, now()),
    approval_updated_at = now()
WHERE d.approval_status = 'PENDIENTE_DOCUMENTOS'
  AND EXISTS (SELECT 1 FROM users u WHERE u.id=d.user_id AND u.deleted_at IS NULL)
  AND (SELECT count(DISTINCT dd.document_type) FROM driver_documents dd
       WHERE dd.driver_id=d.user_id AND dd.status<>'SUSPENDED'
         AND dd.document_type IN ('PROFILE_PHOTO','IDENTIFICATION','LICENSE','REGISTRATION')) = 4;
