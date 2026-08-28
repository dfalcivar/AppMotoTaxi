-- Fiscal identities are reusable, financial documents are immutable snapshots.
-- No provider calls, fiscal authorization or fabricated tax values in this migration.
CREATE TABLE fiscal_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE fiscal_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES fiscal_clients(id),
  link_type text NOT NULL CHECK(link_type IN ('CONDUCTOR','COMERCIO','COOPERATIVA','EMPRESA','OTRO')),
  entity_id uuid NOT NULL,
  user_id uuid REFERENCES users(id),
  advertiser_id uuid REFERENCES advertisers(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(link_type,entity_id),
  CHECK((link_type='CONDUCTOR' AND user_id IS NOT NULL AND user_id=entity_id AND advertiser_id IS NULL)
    OR (link_type='COMERCIO' AND advertiser_id IS NOT NULL AND advertiser_id=entity_id AND user_id IS NULL)
    OR (link_type IN ('COOPERATIVA','EMPRESA','OTRO') AND user_id IS NULL AND advertiser_id IS NULL))
);
CREATE INDEX fiscal_links_client_idx ON fiscal_client_links(client_id);
CREATE TABLE fiscal_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL UNIQUE REFERENCES fiscal_clients(id),
  identification_type text NOT NULL CHECK(identification_type IN ('CEDULA','RUC')),
  identification text NOT NULL,
  legal_name text NOT NULL,
  address text NOT NULL,
  billing_email text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((identification_type='CEDULA' AND identification ~ '^[0-9]{10}$') OR
        (identification_type='RUC' AND identification ~ '^[0-9]{13}$'))
);
CREATE TABLE fiscal_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id uuid REFERENCES fiscal_clients(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  event_type text NOT NULL,
  actor_id uuid REFERENCES users(id),
  actor_process text,
  result text NOT NULL DEFAULT 'SUCCESS',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fiscal_audit_client_idx ON fiscal_audit(client_id,created_at DESC);

ALTER TABLE membership_payment_orders ADD COLUMN fiscal_required boolean NOT NULL DEFAULT false;
ALTER TABLE membership_payment_orders ALTER COLUMN fiscal_required SET DEFAULT true;
ALTER TABLE advertising_orders ADD COLUMN fiscal_required boolean NOT NULL DEFAULT false;
ALTER TABLE advertising_orders ALTER COLUMN fiscal_required SET DEFAULT true;
ALTER TABLE membership_payments ADD COLUMN fiscal_client_id uuid REFERENCES fiscal_clients(id);
ALTER TABLE membership_payments ADD COLUMN fiscal_profile_id uuid REFERENCES fiscal_profiles(id) ON DELETE SET NULL;
ALTER TABLE advertising_payments ADD COLUMN fiscal_client_id uuid REFERENCES fiscal_clients(id);
ALTER TABLE advertising_payments ADD COLUMN fiscal_profile_id uuid REFERENCES fiscal_profiles(id) ON DELETE SET NULL;

CREATE TABLE fiscal_billing_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL CHECK(source IN ('MEMBRESIA','PUBLICIDAD','PUNTO_VENTA','OTRO')),
  payment_id uuid NOT NULL,
  document_type text NOT NULL DEFAULT 'FACTURA',
  client_id uuid REFERENCES fiscal_clients(id),
  fiscal_snapshot jsonb,
  amount numeric(14,2) NOT NULL,
  currency text NOT NULL DEFAULT 'USD',
  concept text NOT NULL,
  zone_id uuid REFERENCES service_areas(id),
  service_type text NOT NULL,
  paid_at timestamptz NOT NULL,
  payment_reversed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source,payment_id,document_type)
);
CREATE INDEX fiscal_billing_pending_idx ON fiscal_billing_outbox(created_at) WHERE processed_at IS NULL;
CREATE INDEX fiscal_billing_date_idx ON fiscal_billing_outbox(paid_at,source);
CREATE INDEX fiscal_billing_client_idx ON fiscal_billing_outbox(client_id,paid_at);
CREATE TABLE fiscal_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_reference text NOT NULL UNIQUE,
  source text NOT NULL,
  service_type text NOT NULL,
  zone_id uuid REFERENCES service_areas(id),
  payment_id uuid NOT NULL,
  document_type text NOT NULL DEFAULT 'FACTURA',
  client_id uuid REFERENCES fiscal_clients(id),
  fiscal_snapshot jsonb,
  concept text NOT NULL,
  subtotal numeric(14,2),
  tax_amount numeric(14,2),
  total numeric(14,2) NOT NULL,
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'PENDIENTE_INTEGRACION' CHECK(status IN
    ('BORRADOR','PENDIENTE','PENDIENTE_INTEGRACION','ENVIANDO','RECIBIDA','AUTORIZADA','RECHAZADA','ERROR','PENDIENTE_REINTENTO','ANULADA')),
  provider text NOT NULL,
  environment text NOT NULL,
  document_number text,
  access_key text,
  authorization_number text,
  issued_at timestamptz,
  authorized_at timestamptz,
  xml_location text,
  ride_location text,
  email_to text,
  email_sent boolean NOT NULL DEFAULT false,
  email_sent_at timestamptz,
  email_status text NOT NULL DEFAULT 'NO_ENVIADO',
  paid_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source,payment_id,document_type),
  CHECK(status<>'AUTORIZADA' OR (fiscal_snapshot IS NOT NULL AND subtotal IS NOT NULL AND tax_amount IS NOT NULL
    AND subtotal>=0 AND tax_amount>=0 AND subtotal+tax_amount=total
    AND document_number IS NOT NULL AND access_key IS NOT NULL AND authorization_number IS NOT NULL AND authorized_at IS NOT NULL))
);
CREATE INDEX fiscal_invoices_date_idx ON fiscal_invoices(created_at,status);
CREATE INDEX fiscal_invoices_client_idx ON fiscal_invoices(client_id,created_at);
CREATE TABLE fiscal_credit_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES fiscal_invoices(id),
  external_reference text NOT NULL UNIQUE,
  fiscal_snapshot jsonb NOT NULL,
  amount numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'PENDIENTE_INTEGRACION',
  document_number text,
  authorization_number text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_authorized_fiscal_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='AUTORIZADA' AND (TG_OP='DELETE' OR to_jsonb(NEW)-ARRAY['email_sent','email_sent_at','email_status','updated_at']
      IS DISTINCT FROM to_jsonb(OLD)-ARRAY['email_sent','email_sent_at','email_status','updated_at']) THEN
    RAISE EXCEPTION 'AUTHORIZED_FISCAL_DOCUMENT_IMMUTABLE';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fiscal_invoice_immutable BEFORE UPDATE OR DELETE ON fiscal_invoices FOR EACH ROW EXECUTE FUNCTION protect_authorized_fiscal_document();
CREATE TRIGGER fiscal_credit_note_immutable BEFORE UPDATE OR DELETE ON fiscal_credit_notes FOR EACH ROW EXECUTE FUNCTION protect_authorized_fiscal_document();

-- Only a durable local intent is captured inside payment transactions. Provider work runs AFTER commit.
CREATE FUNCTION capture_fiscal_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link_kind text; owner_id uuid; origin text; confirmed boolean; paid_date timestamptz;
  client uuid; profile uuid; snapshot jsonb; label text; area uuid;
BEGIN
  IF TG_TABLE_NAME='membership_payments' THEN
    confirmed := NEW.status='CONFIRMED' AND NEW.method<>'COURTESY';
    owner_id := NEW.driver_id; link_kind := 'CONDUCTOR'; origin := 'MEMBRESIA';
    paid_date := coalesce(NEW.confirmed_at,now()); label := 'Membresía Costa-Go';
    SELECT service_area_id INTO area FROM collection_points WHERE id=NEW.collection_point_id;
  ELSE
    confirmed := NEW.status='APPROVED' AND NEW.settlement_status='RECONCILED';
    owner_id := NEW.advertiser_id; link_kind := 'COMERCIO'; origin := 'PUBLICIDAD';
    paid_date := coalesce(NEW.reviewed_at,now()); label := 'Publicidad Costa-Go';
    SELECT service_area_id INTO area FROM affiliate_banners WHERE order_id=NEW.order_id LIMIT 1;
  END IF;
  SELECT l.client_id,p.id,jsonb_build_object('identificationType',p.identification_type,'identification',p.identification,
    'legalName',p.legal_name,'address',p.address,'billingEmail',p.billing_email)
    INTO client,profile,snapshot FROM fiscal_client_links l JOIN fiscal_clients c ON c.id=l.client_id AND c.active
    LEFT JOIN fiscal_profiles p ON p.client_id=l.client_id AND p.active WHERE l.link_type=link_kind AND l.entity_id=owner_id;
  -- Retain the original payment relationship on retries/status changes.
  NEW.fiscal_client_id := coalesce(NEW.fiscal_client_id,client);
  NEW.fiscal_profile_id := coalesce(NEW.fiscal_profile_id,profile);
  IF NEW.status IN ('REVERSED','REFUNDED') THEN
    UPDATE fiscal_billing_outbox SET payment_reversed=true WHERE source=origin AND payment_id=NEW.id;
  END IF;
  IF confirmed THEN
    INSERT INTO fiscal_billing_outbox(source,payment_id,client_id,fiscal_snapshot,amount,currency,concept,zone_id,service_type,paid_at)
    VALUES(origin,NEW.id,client,CASE WHEN profile IS NULL THEN NULL ELSE snapshot END,NEW.amount,NEW.currency,label,area,origin,paid_date)
    ON CONFLICT(source,payment_id,document_type) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER membership_fiscal_payment BEFORE INSERT OR UPDATE OF status ON membership_payments FOR EACH ROW EXECUTE FUNCTION capture_fiscal_payment();
CREATE TRIGGER advertising_fiscal_payment BEFORE INSERT OR UPDATE OF status,settlement_status ON advertising_payments FOR EACH ROW EXECUTE FUNCTION capture_fiscal_payment();

-- Existing confirmed payments remain valid; there is no invented identity or retrospective invoice authorization.
INSERT INTO fiscal_billing_outbox(source,payment_id,amount,currency,concept,service_type,paid_at)
SELECT 'MEMBRESIA',id,amount,currency,'Membresía Costa-Go (histórico)','MEMBRESIA',confirmed_at
FROM membership_payments WHERE status='CONFIRMED' AND method<>'COURTESY' ON CONFLICT DO NOTHING;
INSERT INTO fiscal_billing_outbox(source,payment_id,amount,currency,concept,service_type,paid_at)
SELECT 'PUBLICIDAD',id,amount,currency,'Publicidad Costa-Go (histórico)','PUBLICIDAD',coalesce(reviewed_at,created_at)
FROM advertising_payments WHERE status='APPROVED' AND settlement_status='RECONCILED' ON CONFLICT DO NOTHING;

CREATE FUNCTION remove_deleted_user_fiscal_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE client uuid;
BEGIN
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    FOR client IN SELECT client_id FROM fiscal_client_links WHERE user_id=NEW.id LOOP
      DELETE FROM fiscal_client_links WHERE user_id=NEW.id AND client_id=client;
      IF NOT EXISTS(SELECT 1 FROM fiscal_client_links WHERE client_id=client) THEN
        DELETE FROM fiscal_profiles WHERE client_id=client;
        UPDATE fiscal_clients SET active=false,deleted_at=now(),updated_at=now() WHERE id=client;
        INSERT INTO fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
        VALUES(client,'CLIENTE',client::text,'ClienteFiscalEliminado','ACCOUNT_DELETION');
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER user_fiscal_deletion AFTER UPDATE OF deleted_at ON users FOR EACH ROW EXECUTE FUNCTION remove_deleted_user_fiscal_identity();

CREATE FUNCTION audit_fiscal_profile_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO fiscal_audit(client_id,entity_type,entity_id,event_type,actor_process)
    VALUES(OLD.client_id,'PERFIL_FISCAL',OLD.id::text,'PerfilFiscalEliminado','ACCOUNT_DELETION');
  RETURN OLD;
END $$;
CREATE TRIGGER fiscal_profile_deletion BEFORE DELETE ON fiscal_profiles FOR EACH ROW EXECUTE FUNCTION audit_fiscal_profile_deletion();
