ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS routes_free_cap_reference integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS routes_price_per_thousand_usd numeric(10,2) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS geocoding_free_cap_reference integer NOT NULL DEFAULT 10000,
  ADD COLUMN IF NOT EXISTS geocoding_price_per_thousand_usd numeric(10,2) NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS navigation_price_per_thousand_usd numeric(10,2) NOT NULL DEFAULT 25;
