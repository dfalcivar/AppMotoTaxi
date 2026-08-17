ALTER TABLE user_service_area_access
  ADD COLUMN review_mode boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_service_area_access.review_mode IS
  'Permite mostrar el punto de prueba controlado de la zona a cuentas de revisión autorizadas.';
