ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3) NOT NULL DEFAULT 15.000
    CHECK (vat_rate_percent >= 0 AND vat_rate_percent <= 100);

COMMENT ON COLUMN operational_settings.vat_rate_percent IS
  'Porcentaje de IVA vigente aplicado únicamente al crear nuevas órdenes. Cada orden conserva una instantánea del porcentaje.';

ALTER TABLE membership_payment_orders
  ADD COLUMN IF NOT EXISTS taxable_subtotal numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2);

UPDATE membership_payment_orders
SET taxable_subtotal = total_amount,
    vat_rate_percent = 0,
    vat_amount = 0
WHERE taxable_subtotal IS NULL OR vat_rate_percent IS NULL OR vat_amount IS NULL;

ALTER TABLE membership_payment_orders
  ALTER COLUMN taxable_subtotal SET NOT NULL,
  ALTER COLUMN vat_rate_percent SET NOT NULL,
  ALTER COLUMN vat_amount SET NOT NULL,
  ALTER COLUMN taxable_subtotal SET DEFAULT 0,
  ALTER COLUMN vat_rate_percent SET DEFAULT 0,
  ALTER COLUMN vat_amount SET DEFAULT 0,
  ADD CONSTRAINT membership_payment_orders_vat_rate_check CHECK (vat_rate_percent >= 0 AND vat_rate_percent <= 100),
  ADD CONSTRAINT membership_payment_orders_vat_amount_check CHECK (vat_amount >= 0),
  ADD CONSTRAINT membership_payment_orders_tax_total_check CHECK (taxable_subtotal + vat_amount = total_amount);

ALTER TABLE advertising_orders
  ADD COLUMN IF NOT EXISTS subtotal_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,2);

UPDATE advertising_orders
SET subtotal_amount = amount,
    vat_rate_percent = 0,
    vat_amount = 0
WHERE subtotal_amount IS NULL OR vat_rate_percent IS NULL OR vat_amount IS NULL;

ALTER TABLE advertising_orders
  ALTER COLUMN subtotal_amount SET NOT NULL,
  ALTER COLUMN vat_rate_percent SET NOT NULL,
  ALTER COLUMN vat_amount SET NOT NULL,
  ALTER COLUMN subtotal_amount SET DEFAULT 0,
  ALTER COLUMN vat_rate_percent SET DEFAULT 0,
  ALTER COLUMN vat_amount SET DEFAULT 0,
  ADD CONSTRAINT advertising_orders_vat_rate_check CHECK (vat_rate_percent >= 0 AND vat_rate_percent <= 100),
  ADD CONSTRAINT advertising_orders_vat_amount_check CHECK (vat_amount >= 0),
  ADD CONSTRAINT advertising_orders_tax_total_check CHECK (subtotal_amount + vat_amount = amount);

COMMENT ON COLUMN membership_payment_orders.taxable_subtotal IS 'Subtotal gravado congelado al crear la orden.';
COMMENT ON COLUMN membership_payment_orders.vat_rate_percent IS 'Porcentaje de IVA congelado al crear la orden.';
COMMENT ON COLUMN membership_payment_orders.vat_amount IS 'IVA calculado y redondeado a centavos al crear la orden.';
COMMENT ON COLUMN advertising_orders.subtotal_amount IS 'Subtotal gravado congelado al crear la orden.';
COMMENT ON COLUMN advertising_orders.vat_rate_percent IS 'Porcentaje de IVA congelado al crear la orden.';
COMMENT ON COLUMN advertising_orders.vat_amount IS 'IVA calculado y redondeado a centavos al crear la orden.';

ALTER TABLE fiscal_billing_outbox
  ADD COLUMN IF NOT EXISTS subtotal numeric(14,2),
  ADD COLUMN IF NOT EXISTS vat_rate_percent numeric(6,3),
  ADD COLUMN IF NOT EXISTS tax_amount numeric(14,2);

UPDATE fiscal_billing_outbox
SET subtotal = amount,
    vat_rate_percent = 0,
    tax_amount = 0
WHERE subtotal IS NULL OR vat_rate_percent IS NULL OR tax_amount IS NULL;

ALTER TABLE fiscal_billing_outbox
  ALTER COLUMN subtotal SET NOT NULL,
  ALTER COLUMN vat_rate_percent SET NOT NULL,
  ALTER COLUMN tax_amount SET NOT NULL,
  ALTER COLUMN subtotal SET DEFAULT 0,
  ALTER COLUMN vat_rate_percent SET DEFAULT 0,
  ALTER COLUMN tax_amount SET DEFAULT 0,
  ADD CONSTRAINT fiscal_billing_outbox_tax_total_check CHECK (subtotal + tax_amount = amount);

CREATE OR REPLACE FUNCTION capture_fiscal_payment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE link_kind text; owner_id uuid; origin text; confirmed boolean; paid_date timestamptz;
  client uuid; profile uuid; snapshot jsonb; label text; area uuid;
  order_subtotal numeric(14,2); order_vat_rate numeric(6,3); order_tax numeric(14,2);
BEGIN
  IF TG_TABLE_NAME='membership_payments' THEN
    confirmed := NEW.status='CONFIRMED' AND NEW.method<>'COURTESY';
    owner_id := NEW.driver_id; link_kind := 'CONDUCTOR'; origin := 'MEMBRESIA';
    paid_date := coalesce(NEW.confirmed_at,now()); label := 'Membresía Costa-Go';
    SELECT service_area_id INTO area FROM collection_points WHERE id=NEW.collection_point_id;
    SELECT taxable_subtotal,vat_rate_percent,vat_amount INTO order_subtotal,order_vat_rate,order_tax
      FROM membership_payment_orders WHERE id=NEW.order_id;
  ELSE
    confirmed := NEW.status='APPROVED' AND NEW.settlement_status='RECONCILED';
    owner_id := NEW.advertiser_id; link_kind := 'COMERCIO'; origin := 'PUBLICIDAD';
    paid_date := coalesce(NEW.reviewed_at,now()); label := 'Publicidad Costa-Go';
    SELECT service_area_id INTO area FROM affiliate_banners WHERE order_id=NEW.order_id LIMIT 1;
    SELECT subtotal_amount,vat_rate_percent,vat_amount INTO order_subtotal,order_vat_rate,order_tax
      FROM advertising_orders WHERE id=NEW.order_id;
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
    INSERT INTO fiscal_billing_outbox(source,payment_id,client_id,fiscal_snapshot,subtotal,vat_rate_percent,tax_amount,amount,currency,concept,zone_id,service_type,paid_at)
    VALUES(origin,NEW.id,client,CASE WHEN profile IS NULL THEN NULL ELSE snapshot END,
      coalesce(order_subtotal,NEW.amount),coalesce(order_vat_rate,0),coalesce(order_tax,0),NEW.amount,NEW.currency,label,area,origin,paid_date)
    ON CONFLICT(source,payment_id,document_type) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
