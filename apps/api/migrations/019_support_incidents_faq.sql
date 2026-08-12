ALTER TABLE incidents DROP CONSTRAINT IF EXISTS incidents_status_check;

UPDATE incidents SET status = CASE status
  WHEN 'OPEN' THEN 'NUEVO'
  WHEN 'IN_REVIEW' THEN 'EN_REVISION'
  WHEN 'RESOLVED' THEN 'RESUELTO'
  ELSE status
END;

ALTER TABLE incidents
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'MEDIA',
  ADD COLUMN IF NOT EXISTS preferred_contact text NOT NULL DEFAULT 'APP',
  ADD COLUMN IF NOT EXISTS related_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cooperative_id uuid REFERENCES cooperatives(id) ON DELETE SET NULL;

UPDATE incidents SET subject = coalesce(subject, category) WHERE subject IS NULL;
ALTER TABLE incidents ALTER COLUMN subject SET NOT NULL;
ALTER TABLE incidents ADD CONSTRAINT incidents_status_check CHECK (status IN (
  'NUEVO','ASIGNADO','EN_REVISION','ESPERANDO_USUARIO','RESUELTO','CERRADO'
));
ALTER TABLE incidents ADD CONSTRAINT incidents_priority_check CHECK (priority IN (
  'BAJA','MEDIA','ALTA','CRITICA'
));
ALTER TABLE incidents ADD CONSTRAINT incidents_contact_check CHECK (preferred_contact IN (
  'APP','TELEFONO','WHATSAPP','CORREO'
));

CREATE TABLE IF NOT EXISTS support_incident_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  author_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role text NOT NULL,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'USER' CHECK (visibility IN ('USER','INTERNAL')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_incident_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES users(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  file_mime text NOT NULL CHECK (file_mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 2500000),
  file_data bytea NOT NULL,
  visibility text NOT NULL DEFAULT 'USER' CHECK (visibility IN ('USER','INTERNAL')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS support_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  audiences text[] NOT NULL DEFAULT ARRAY['PASSENGER','DRIVER'],
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS incidents_reporter_created_idx ON incidents(reported_by, created_at DESC);
CREATE INDEX IF NOT EXISTS incidents_assignment_status_idx ON incidents(assigned_to, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_incident_idx ON support_incident_messages(incident_id, created_at);
CREATE INDEX IF NOT EXISTS support_attachments_incident_idx ON support_incident_attachments(incident_id, created_at);
CREATE INDEX IF NOT EXISTS support_faqs_active_order_idx ON support_faqs(active, sort_order, category);

INSERT INTO support_faqs (id, category, question, answer, sort_order) VALUES
  ('00000000-0000-0000-0000-000000001901','Viajes','¿Cómo contacto al conductor o pasajero?','Cuando exista un viaje asignado utiliza los botones de llamada o chat del detalle del viaje. No compartas información personal fuera de la aplicación.',10),
  ('00000000-0000-0000-0000-000000001902','Viajes','¿Qué hago si olvidé un objeto?','Crea una solicitud de soporte, selecciona Objetos olvidados y relaciona el viaje. El equipo revisará los datos y te ayudará a contactar a la otra persona.',20),
  ('00000000-0000-0000-0000-000000001903','Pagos','Tengo un problema con el pago','Crea una solicitud indicando el viaje, método de pago y lo ocurrido. No adjuntes claves, contraseñas ni datos bancarios sensibles.',30),
  ('00000000-0000-0000-0000-000000001904','Seguridad','¿Cómo reporto un problema de seguridad?','Si existe peligro inmediato comunícate con los servicios de emergencia. En Costa-Go crea un caso con prioridad crítica para que soporte lo atienda de forma prioritaria.',40),
  ('00000000-0000-0000-0000-000000001905','Aplicación','La aplicación no funciona correctamente','Verifica tu conexión y vuelve a intentarlo. Si continúa, crea una solicitud e indica el teléfono, la pantalla y el mensaje de error observado.',50)
ON CONFLICT (id) DO NOTHING;
