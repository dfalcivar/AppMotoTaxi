update support_faqs
set answer = replace(replace(answer, 'AtacamesGo', 'Costa-Go'), 'Mototaxi Atacames', 'Costa-Go'),
    updated_at = now()
where answer ilike '%AtacamesGo%'
   or answer ilike '%Mototaxi Atacames%';
