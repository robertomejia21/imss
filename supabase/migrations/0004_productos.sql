-- Catálogo de productos y varios productos por prospecto.
-- Cada producto que pide un prospecto es una fila en "tramites" (tipo = nombre del producto).
-- Ejecutar en Supabase: SQL Editor → pegar → Run

-- "Pidió información": le interesa el producto, pero aún no se registra
alter type tramite_status add value if not exists 'interesado' before 'pendiente';

-- ---------- Catálogo ----------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  description text not null default '',        -- qué es, precio y requisitos (el agente de IA lo usa para ofrecerlo)
  offered_by_ai boolean not null default false, -- el agente de IA lo ofrece por WhatsApp
  active boolean not null default true,         -- aparece en formularios y en el CRM
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table products enable row level security;
create policy "staff all" on products for all to authenticated using (true) with check (true);

insert into products (name, offered_by_ai, sort_order) values
  ('Alta en IMSS', true, 10),
  ('Retiro por desempleo', true, 20),
  ('Salario Topado', true, 30),
  ('Pensión por cesantía / vejez', false, 40),
  ('Modalidad 40', false, 50),
  ('Modalidad 10', false, 60),
  ('Constancia de semanas cotizadas', false, 70),
  ('Asignación / localización de NSS', false, 80),
  ('Alta en clínica (UMF)', false, 90),
  ('Corrección de datos', false, 100),
  ('Otro', false, 110)
on conflict (name) do nothing;

-- ---------- Un mismo producto no se repite mientras siga abierto ----------
create unique index if not exists tramites_lead_tipo_abierto
  on tramites (lead_id, lower(tipo))
  where status not in ('resuelto', 'rechazado', 'cancelado');

-- ---------- leads.tramite_type = resumen de los productos del prospecto ----------
create or replace function sync_lead_tramite_type() returns trigger
language plpgsql security definer set search_path = public as $$
declare lid uuid := coalesce(new.lead_id, old.lead_id);
begin
  update leads set tramite_type = (
    select string_agg(tipo, ', ' order by created_at)
    from tramites
    where lead_id = lid and status not in ('rechazado', 'cancelado')
  ) where id = lid;
  return null;
end $$;

drop trigger if exists tramites_sync_lead on tramites;
create trigger tramites_sync_lead
  after insert or update or delete on tramites
  for each row execute function sync_lead_tramite_type();
