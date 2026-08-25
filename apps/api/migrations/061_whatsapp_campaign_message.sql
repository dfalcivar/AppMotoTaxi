alter table affiliate_banners
  add column if not exists action_message text;

update affiliate_banners
set action_message = 'Hola, vi su publicidad en Costa-Go y deseo más información.',
    updated_at = now()
where action_type = 'WHATSAPP'
  and coalesce(trim(action_message), '') = '';
