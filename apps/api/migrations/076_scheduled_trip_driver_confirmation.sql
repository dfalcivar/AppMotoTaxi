alter table operational_settings
  add column if not exists scheduled_trip_driver_reminder_minutes smallint not null default 30
    check (scheduled_trip_driver_reminder_minutes between 10 and 180),
  add column if not exists scheduled_trip_confirmation_grace_minutes smallint not null default 5
    check (scheduled_trip_confirmation_grace_minutes between 1 and 30);

alter table trips
  add column if not exists driver_prepare_reminder_sent_at timestamptz,
  add column if not exists driver_confirmation_requested_at timestamptz,
  add column if not exists driver_confirmation_deadline_at timestamptz;

create index if not exists idx_trips_scheduled_driver_preparation
  on trips (scheduled_for)
  where scheduled_for is not null
    and status = 'SEARCHING'
    and schedule_status = 'SCHEDULED_ASSIGNED';

comment on column operational_settings.scheduled_trip_driver_reminder_minutes is
  'Anticipación para recordar al conductor que debe abrir Costa-Go y preparar su jornada.';
comment on column operational_settings.scheduled_trip_confirmation_grace_minutes is
  'Ventana concedida desde la activación de la reserva para confirmar una sesión de mototaxi elegible.';
comment on column trips.driver_confirmation_deadline_at is
  'Fecha límite para que el conductor confirme una mototaxi/jornada antes de liberar automáticamente la reserva.';
