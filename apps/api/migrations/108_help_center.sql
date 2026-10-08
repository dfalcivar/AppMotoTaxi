create table help_articles (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title text not null,
  summary text not null default '',
  body text not null default '',
  category text not null,
  audience text not null check (audience in ('DRIVER','PASSENGER','BOTH')),
  status text not null default 'DRAFT' check (status in ('DRAFT','PUBLISHED','HIDDEN')),
  featured boolean not null default false,
  sort_order integer not null default 0,
  cover_key text,
  video_key text,
  pdf_key text,
  cover_url text,
  video_url text,
  pdf_url text,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  updated_at timestamptz not null default now()
);
create index help_articles_public_order on help_articles(audience,category,sort_order,updated_at desc) where status='PUBLISHED';

insert into admin_custom_role_permissions(role_id,permission)
select id,permission from admin_custom_roles cross join (values ('help:view'),('help:manage')) as new_permission(permission)
where id='e6031b0f-cab8-44b0-9907-67412fba26a8'::uuid on conflict do nothing;

-- The first guide follows the documented app flow. Media is deployed on the static site;
-- subsequent admin uploads use the existing private R2 bucket.
insert into help_articles(slug,title,summary,body,category,audience,status,featured,sort_order,video_url,pdf_url,published_at)
values (
 'vincular-mototaxi',
 'Cómo registrar o vincular tu mototaxi',
 'Aprende a registrar una unidad nueva, vincular una existente y completar la revisión para empezar a recibir viajes.',
 E'Abre Inicio y toca tu foto o saludo. En Mi cuenta entra a Mi perfil, luego a Mis mototaxis y pulsa Agregar mototaxi.\n\nSi la unidad todavía no está en Costa-Go, selecciona Nueva unidad. Ingresa la placa o registro, marca, modelo, color, número de unidad y propietario declarado. Indica tu relación con ella. Si vas a conducir, selecciona Conductor autorizado. Sube una foto real, clara y completa: EL NÚMERO DE LA MOTOTAXI DEBE VERSE LEGIBLE Y VISIBLE. La app admite JPG o PNG de hasta 5 MB. Guarda para enviar la solicitud a revisión.\n\nSi la mototaxi ya existe, elige Vincular existente. Escribe exactamente la placa o registro y selecciona Conductor autorizado si vas a conducir. No registres una ficha duplicada. En este formulario no se vuelve a cargar la foto.\n\nEspera la revisión. Tener tu nombre como propietario declarado no equivale a estar autorizado para conducir. La unidad debe estar verificada, tu autorización aprobada y tu cuenta de conductor aprobada y activa.\n\nCuando se aprueben esas condiciones, vuelve a Inicio y abre la selección de mototaxi. Revisa la placa y el número de unidad; en «Hoy conducirás…» toca Usar mototaxi. Después activa Disponible para viajes cuando tus documentos, ubicación y cobertura estén en regla. Si la unidad no aparece, consulta su estado en Mis mototaxis y solicita ayuda al equipo de Costa-Go.',
 'Registrar o vincular mototaxis','DRIVER','PUBLISHED',true,0,
 '/assets/help/Video_paso_a_paso_vincular_mototaxi_Costa-Go_narrado.mp4',
 '/assets/help/Manual_vincular_mototaxi_Costa-Go_publico.pdf',now()
)
on conflict (slug) do nothing;
