insert into support_faqs
  (id, category, question, answer, audiences, sort_order, active)
values
  (
    '00000000-0000-0000-0000-000000001907',
    'Viajes',
    '¿Cómo consulto mis viajes anteriores?',
    'Entra en Mi cuenta, abre Mi perfil y selecciona Mis viajes. Allí encontrarás los viajes en curso y el historial de viajes anteriores; también podrás abrir su detalle o reagendar un recorrido cuando corresponda.',
    array['PASSENGER','DRIVER'],
    15,
    true
  ),
  (
    '00000000-0000-0000-0000-000000001908',
    'Tarifas',
    '¿Dónde consulto el tarifario?',
    'Puedes consultar el tarifario territorial vigente de Costa-Go en https://mototaxi-atacames-admin.onrender.com/fares.html. Antes de confirmar un viaje, la aplicación también muestra el valor aplicable o sugerido para el recorrido.',
    array['PASSENGER','DRIVER'],
    35,
    true
  )
on conflict (id) do update set
  category = excluded.category,
  question = excluded.question,
  answer = excluded.answer,
  audiences = excluded.audiences,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();
