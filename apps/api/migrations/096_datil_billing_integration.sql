-- Dátil integration state. Existing fiscal documents are deliberately ineligible:
-- a deployment or credential change must never emit historical records.
ALTER TABLE fiscal_billing_outbox
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE fiscal_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS remote_id text,
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS sequential integer,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS emission_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_error_message text;

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_invoices_provider_remote_uidx
  ON fiscal_invoices(provider,environment,remote_id) WHERE remote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS fiscal_invoices_worker_idx
  ON fiscal_invoices(next_attempt_at,created_at)
  WHERE emission_eligible AND status IN ('PENDIENTE','PENDIENTE_REINTENTO','ENVIANDO','RECIBIDA');

ALTER TABLE fiscal_credit_notes
  ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS remote_id text,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'DATIL',
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'TEST',
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS sequential integer,
  ADD COLUMN IF NOT EXISTS access_key text,
  ADD COLUMN IF NOT EXISTS reason text,
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS authorized_at timestamptz,
  ADD COLUMN IF NOT EXISTS xml_location text,
  ADD COLUMN IF NOT EXISTS ride_location text,
  ADD COLUMN IF NOT EXISTS emission_eligible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_check_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_error_code text,
  ADD COLUMN IF NOT EXISTS provider_error_message text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE UNIQUE INDEX IF NOT EXISTS fiscal_credit_notes_provider_remote_uidx
  ON fiscal_credit_notes(provider,environment,remote_id) WHERE remote_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS fiscal_credit_notes_idempotency_uidx
  ON fiscal_credit_notes(idempotency_key);
CREATE INDEX IF NOT EXISTS fiscal_credit_notes_worker_idx
  ON fiscal_credit_notes(next_attempt_at,created_at)
  WHERE emission_eligible AND status IN ('PENDIENTE','PENDIENTE_REINTENTO','ENVIANDO','RECIBIDA');

CREATE TABLE IF NOT EXISTS fiscal_sequences (
  document_type text NOT NULL CHECK(document_type IN ('FACTURA','NOTA_CREDITO')),
  environment text NOT NULL CHECK(environment IN ('TEST','PRODUCTION')),
  establishment_code char(3) NOT NULL CHECK(establishment_code ~ '^[0-9]{3}$'),
  emission_point char(3) NOT NULL CHECK(emission_point ~ '^[0-9]{3}$'),
  next_value integer NOT NULL CHECK(next_value BETWEEN 1 AND 1000000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_type,environment,establishment_code,emission_point)
);

CREATE OR REPLACE FUNCTION allocate_fiscal_sequence(
  p_document_type text,p_environment text,p_establishment char(3),p_emission_point char(3),p_initial integer
) RETURNS integer LANGUAGE plpgsql AS $$
DECLARE allocated integer;
BEGIN
  IF p_initial<1 OR p_initial>999999999 THEN RAISE EXCEPTION 'INVALID_FISCAL_INITIAL_SEQUENCE'; END IF;
  INSERT INTO fiscal_sequences(document_type,environment,establishment_code,emission_point,next_value)
  VALUES(p_document_type,p_environment,p_establishment,p_emission_point,p_initial+1)
  ON CONFLICT(document_type,environment,establishment_code,emission_point)
  DO UPDATE SET next_value=fiscal_sequences.next_value+1,updated_at=now()
  RETURNING next_value-1 INTO allocated;
  IF allocated>999999999 THEN RAISE EXCEPTION 'FISCAL_SEQUENCE_EXHAUSTED'; END IF;
  RETURN allocated;
END $$;

-- Webhook payloads are not trusted as authorization evidence. Only a compact,
-- deduplicated wake-up signal is retained; the worker re-queries Dátil.
CREATE TABLE IF NOT EXISTS fiscal_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_name text NOT NULL,
  remote_id text NOT NULL,
  event_key text NOT NULL UNIQUE,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  matched_invoice_id uuid REFERENCES fiscal_invoices(id),
  matched_credit_note_id uuid REFERENCES fiscal_credit_notes(id)
);
CREATE INDEX IF NOT EXISTS fiscal_provider_events_remote_idx
  ON fiscal_provider_events(provider,remote_id,received_at DESC);

-- Provider download URLs and email delivery metadata can appear after SRI
-- authorization. The fiscal amounts and authorization identity remain immutable.
CREATE OR REPLACE FUNCTION protect_authorized_fiscal_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='AUTORIZADA' AND (TG_OP='DELETE' OR to_jsonb(NEW)-ARRAY['email_sent','email_sent_at','email_status','xml_location','ride_location','updated_at']
      IS DISTINCT FROM to_jsonb(OLD)-ARRAY['email_sent','email_sent_at','email_status','xml_location','ride_location','updated_at']) THEN
    RAISE EXCEPTION 'AUTHORIZED_FISCAL_DOCUMENT_IMMUTABLE';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;

-- Capture the immutable concept and payment method at confirmation time.
CREATE OR REPLACE FUNCTION capture_fiscal_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link_kind text; owner_id uuid; origin text; confirmed boolean; paid_date timestamptz;
  client uuid; profile uuid; snapshot jsonb; label text; area uuid; service text; method_code text;
  order_subtotal numeric(14,2); order_vat_rate numeric(6,3); order_tax numeric(14,2); order_purpose text;
BEGIN
  IF TG_TABLE_NAME='membership_payments' THEN
    confirmed := NEW.status='CONFIRMED' AND NEW.method<>'COURTESY';
    owner_id := NEW.driver_id; link_kind := 'CONDUCTOR'; origin := 'MEMBRESIA'; method_code := NEW.method;
    paid_date := coalesce(NEW.confirmed_at,now());
    SELECT service_area_id INTO area FROM collection_points WHERE id=NEW.collection_point_id;
    SELECT taxable_subtotal,vat_rate_percent,vat_amount,purpose
      INTO order_subtotal,order_vat_rate,order_tax,order_purpose
      FROM membership_payment_orders WHERE id=NEW.order_id;
    IF order_purpose='WALLET_TOPUP' THEN
      label := 'Recarga de saldo Costa-Go'; service := 'RECARGA';
    ELSE
      label := 'Membresía Costa-Go'; service := 'MEMBRESIA';
    END IF;
  ELSE
    confirmed := NEW.status='APPROVED' AND NEW.settlement_status='RECONCILED';
    owner_id := NEW.advertiser_id; link_kind := 'COMERCIO'; origin := 'PUBLICIDAD'; service := 'PUBLICIDAD';
    paid_date := coalesce(NEW.reviewed_at,now()); label := 'Publicidad Costa-Go';
    SELECT service_area_id INTO area FROM affiliate_banners WHERE order_id=NEW.order_id LIMIT 1;
    SELECT subtotal_amount,vat_rate_percent,vat_amount INTO order_subtotal,order_vat_rate,order_tax
      FROM advertising_orders WHERE id=NEW.order_id;
    SELECT code INTO method_code FROM advertising_payment_methods WHERE id=NEW.payment_method_id;
  END IF;
  SELECT l.client_id,p.id,jsonb_build_object('identificationType',p.identification_type,'identification',p.identification,
    'legalName',p.legal_name,'address',p.address,'billingEmail',p.billing_email)
    INTO client,profile,snapshot FROM fiscal_client_links l JOIN fiscal_clients c ON c.id=l.client_id AND c.active
    LEFT JOIN fiscal_profiles p ON p.client_id=l.client_id AND p.active WHERE l.link_type=link_kind AND l.entity_id=owner_id;
  NEW.fiscal_client_id := coalesce(NEW.fiscal_client_id,client);
  NEW.fiscal_profile_id := coalesce(NEW.fiscal_profile_id,profile);
  IF NEW.status IN ('REVERSED','REFUNDED') THEN
    UPDATE fiscal_billing_outbox SET payment_reversed=true WHERE source=origin AND payment_id=NEW.id;
  END IF;
  IF confirmed THEN
    INSERT INTO fiscal_billing_outbox(source,payment_id,client_id,fiscal_snapshot,subtotal,vat_rate_percent,tax_amount,
      amount,currency,concept,zone_id,service_type,paid_at,payment_method)
    VALUES(origin,NEW.id,client,CASE WHEN profile IS NULL THEN NULL ELSE snapshot END,
      coalesce(order_subtotal,NEW.amount),coalesce(order_vat_rate,0),coalesce(order_tax,0),NEW.amount,NEW.currency,
      label,area,service,paid_date,method_code)
    ON CONFLICT(source,payment_id,document_type) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
