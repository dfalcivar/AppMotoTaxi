UPDATE users
SET
  email = 'pasajera@mototaxi.local',
  password_hash = crypt('Pasajera2026!', gen_salt('bf'))
WHERE id = '00000000-0000-0000-0000-000000000201';

UPDATE users
SET
  email = 'conductor@mototaxi.local',
  password_hash = crypt('Conductor2026!', gen_salt('bf'))
WHERE id = '00000000-0000-0000-0000-000000000102';
