ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'COMMERCIAL';

CREATE SEQUENCE IF NOT EXISTS advertising_lead_code_seq;
CREATE SEQUENCE IF NOT EXISTS advertising_request_code_seq;
CREATE SEQUENCE IF NOT EXISTS advertising_order_code_seq;

CREATE TABLE IF NOT EXISTS advertisers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  legal_name text,
  contact_name text NOT NULL,
  phone_e164 text NOT NULL,
  email text NOT NULL,
  city text NOT NULL,
  business_type text NOT NULL,
  status text NOT NULL DEFAULT 'PROSPECT' CHECK (status IN ('PROSPECT','ACTIVE','INACTIVE','BLOCKED')),
  assigned_commercial_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS advertisers_email_business_unique
  ON advertisers(lower(email), lower(business_name));
CREATE INDEX IF NOT EXISTS advertisers_commercial_status_idx
  ON advertisers(assigned_commercial_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS advertising_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  business_name text NOT NULL,
  contact_name text NOT NULL,
  phone_e164 text NOT NULL,
  email text NOT NULL,
  city text NOT NULL,
  business_type text NOT NULL,
  interest text NOT NULL,
  source text NOT NULL CHECK (source IN ('INSTAGRAM','FACEBOOK','WHATSAPP','WEB','COMMERCIAL','ADMIN','OTHER')),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','IN_PROGRESS','QUALIFIED','REQUIRES_CONTACT','CONVERTED','LOST')),
  advertiser_id uuid REFERENCES advertisers(id) ON DELETE SET NULL,
  assigned_commercial_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  conversation_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_contact_at timestamptz,
  lost_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advertising_leads_status_source_idx
  ON advertising_leads(status,source,created_at DESC);
CREATE INDEX IF NOT EXISTS advertising_leads_assigned_idx
  ON advertising_leads(assigned_commercial_id,status,updated_at DESC);

CREATE TABLE IF NOT EXISTS advertising_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES advertising_leads(id) ON DELETE CASCADE,
  advertiser_id uuid REFERENCES advertisers(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'CREATED' CHECK (status IN ('CREATED','OPENED','IN_PROGRESS','SUBMITTED','EXPIRED','REVOKED','CORRECTION')),
  source text NOT NULL,
  purpose text NOT NULL DEFAULT 'APPLICATION' CHECK (purpose IN ('APPLICATION','CORRECTION')),
  correction_fields text[] NOT NULL DEFAULT '{}',
  draft_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  submitted_at timestamptz,
  revoked_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advertising_invitations_lead_idx
  ON advertising_invitations(lead_id,created_at DESC);
CREATE INDEX IF NOT EXISTS advertising_invitations_expiry_idx
  ON advertising_invitations(status,expires_at);

ALTER TABLE advertising_plans
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS placement text,
  ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS price numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
UPDATE advertising_plans SET price=monthly_price WHERE price=0 AND monthly_price>0;

CREATE TABLE IF NOT EXISTS advertising_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  instructions text,
  account_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  requires_proof boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO advertising_payment_methods(code,name,instructions,active,requires_proof,sort_order)
VALUES ('BANK_TRANSFER','Transferencia bancaria','Adjunta un comprobante legible para revisión.',true,true,10),
       ('COMMERCIAL_MANAGED','Pago gestionado por comercial','Un asesor coordinará la forma de pago.',true,false,20)
ON CONFLICT(code) DO NOTHING;

CREATE TABLE IF NOT EXISTS advertising_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  lead_id uuid REFERENCES advertising_leads(id) ON DELETE SET NULL,
  advertiser_id uuid NOT NULL REFERENCES advertisers(id),
  plan_id uuid NOT NULL REFERENCES advertising_plans(id),
  assigned_commercial_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_PAYMENT','PAYMENT_REVIEW','PAID','CANCELLED','REFUNDED')),
  amount numeric(12,2) NOT NULL CHECK (amount>=0),
  currency char(3) NOT NULL DEFAULT 'USD',
  plan_snapshot jsonb NOT NULL,
  requested_start_at timestamptz,
  requested_end_at timestamptz,
  notes text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS advertising_orders_status_date_idx ON advertising_orders(status,created_at DESC);

CREATE TABLE IF NOT EXISTS advertising_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES advertising_orders(id),
  advertiser_id uuid NOT NULL REFERENCES advertisers(id),
  amount numeric(12,2) NOT NULL CHECK (amount>=0),
  currency char(3) NOT NULL DEFAULT 'USD',
  payment_method_id uuid NOT NULL REFERENCES advertising_payment_methods(id),
  proof_mime text,
  proof_data bytea,
  reference text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','UNDER_REVIEW','APPROVED','REJECTED','REFUNDED')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (proof_data IS NULL OR octet_length(proof_data)<=5242880)
);
CREATE INDEX IF NOT EXISTS advertising_payments_status_date_idx ON advertising_payments(status,created_at DESC);

ALTER TABLE affiliate_banners
  ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES advertising_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS correction_note text,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz;
ALTER TABLE affiliate_banners DROP CONSTRAINT IF EXISTS affiliate_banners_campaign_status_check;
ALTER TABLE affiliate_banners ADD CONSTRAINT affiliate_banners_campaign_status_check
  CHECK (campaign_status IN ('DRAFT','PENDING_PAYMENT','PAYMENT_REVIEW','PENDING_REVIEW','APPROVED','SCHEDULED','ACTIVE','PAUSED','REJECTED','EXPIRED','CANCELLED','FINISHED'));
ALTER TABLE affiliate_banners DROP CONSTRAINT IF EXISTS affiliate_banners_advertiser_fk;
ALTER TABLE affiliate_banners ADD CONSTRAINT affiliate_banners_advertiser_fk
  FOREIGN KEY(advertiser_id) REFERENCES advertisers(id) ON DELETE SET NULL NOT VALID;

CREATE TABLE IF NOT EXISTS campaign_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES affiliate_banners(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  note text,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_status_history_campaign_idx ON campaign_status_history(campaign_id,created_at DESC);

ALTER TABLE advertising_events
  ADD COLUMN IF NOT EXISTS platform text NOT NULL DEFAULT 'MOBILE';

ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS advertising_invitation_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS advertising_max_image_bytes integer NOT NULL DEFAULT 1048576,
  ADD COLUMN IF NOT EXISTS advertising_banner_width integer NOT NULL DEFAULT 1200,
  ADD COLUMN IF NOT EXISTS advertising_banner_height integer NOT NULL DEFAULT 400,
  ADD COLUMN IF NOT EXISTS advertising_commercial_emails text[] NOT NULL DEFAULT '{}';

