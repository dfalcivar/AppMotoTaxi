-- Las campañas solicitan un número de WhatsApp al comercio, pero la aplicación
-- necesita un enlace HTTPS para abrir la conversación. Normaliza los registros
-- históricos, incluida la campaña activa de Cafetería LA MAMA.
with candidates as (
  select id,
         regexp_replace(action_value, '[^0-9]', '', 'g') as digits
  from affiliate_banners
  where action_type = 'WHATSAPP'
    and action_value is not null
    and action_value !~ '^https://wa\.me/[0-9]{10,15}$'
), normalized as (
  select id,
         case
           when length(digits) = 10 and digits like '0%' then '593' || substring(digits from 2)
           when length(digits) = 9 and digits like '9%' then '593' || digits
           when length(digits) between 10 and 15 then digits
           else null
         end as international_digits
  from candidates
)
update affiliate_banners banner
set action_value = 'https://wa.me/' || normalized.international_digits,
    updated_at = now()
from normalized
where banner.id = normalized.id
  and normalized.international_digits is not null;

