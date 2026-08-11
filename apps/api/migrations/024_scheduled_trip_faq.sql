INSERT INTO support_faqs
  (id, category, question, answer, audiences, sort_order, active)
VALUES
  (
    '00000000-0000-0000-0000-000000001906',
    'Viajes programados',
    '¿Cómo programo un viaje para más tarde?',
    'En la pantalla principal selecciona «Programar para más tarde», elige una fecha y hora dentro de las próximas 24 horas y configura el origen, los destinos y las paradas. Revisa la distancia, el tiempo y la tarifa estimada antes de confirmar. La aplicación te indicará la anticipación mínima permitida. Después podrás consultar, modificar o cancelar la solicitud desde «Viajes programados» mientras aún no haya comenzado.',
    ARRAY['PASSENGER'],
    25,
    true
  )
ON CONFLICT (id) DO UPDATE SET
  category = EXCLUDED.category,
  question = EXCLUDED.question,
  answer = EXCLUDED.answer,
  audiences = EXCLUDED.audiences,
  sort_order = EXCLUDED.sort_order,
  active = EXCLUDED.active,
  updated_at = now();
