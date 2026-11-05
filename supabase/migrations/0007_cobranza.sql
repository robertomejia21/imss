-- Cobranza de comisiones: cuando un producto de un prospecto queda "resuelto / ganado",
-- se crea un cobro (uno por producto) para darle seguimiento en /cobranza.
-- Ejecutar en Supabase: SQL Editor → pegar → Run

-- ---------- Precio y comisión sugeridos por producto ----------
alter table products add column if not exists precio numeric(12,2);
alter table products add column if not exists comision numeric(12,2);

-- ---------- Cobros ----------
create table if not exists cobros (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  tramite_id uuid unique references tramites(id) on delete set null, -- un cobro por producto
  servicio text not null,                                             -- nombre del producto al momento del cobro
  asesor_id uuid references profiles(id) on delete set null,
  monto_servicio numeric(12,2),                                       -- lo que pagó / obtuvo el cliente
  comision numeric(12,2) not null default 0,                          -- lo que se le cobra
  monto_cobrado numeric(12,2) not null default 0,                     -- abonos recibidos
  status text not null default 'pendiente'
    check (status in ('pendiente', 'enviado', 'parcial', 'pagado', 'cancelado')),
  fecha_servicio date not null default current_date,                  -- cuándo se logró el servicio
  fecha_limite date default (current_date + 15),                      -- fecha compromiso de pago
  fecha_pago date,
  metodo_pago text,
  referencia text,
  notas text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cobros_status_idx on cobros (status);
create index if not exists cobros_lead_idx on cobros (lead_id);

drop trigger if exists cobros_touch on cobros;
create trigger cobros_touch before update on cobros for each row execute function touch_updated_at();

alter table cobros enable row level security;
drop policy if exists "staff all" on cobros;
create policy "staff all" on cobros for all to authenticated using (true) with check (true);

do $$ begin
  alter publication supabase_realtime add table cobros;
exception when duplicate_object then null;
end $$;

-- ---------- Producto resuelto → cobro ----------
create or replace function cobro_from_tramite() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'resuelto' and (tg_op = 'INSERT' or old.status is distinct from 'resuelto') then
    insert into cobros (lead_id, tramite_id, servicio, asesor_id, monto_servicio, comision)
    select new.lead_id, new.id, new.tipo,
           coalesce(new.assigned_to, l.assigned_to),
           p.precio, coalesce(p.comision, 0)
    from leads l
    left join products p on lower(p.name) = lower(new.tipo)
    where l.id = new.lead_id
    on conflict (tramite_id) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists tramites_cobro on tramites;
create trigger tramites_cobro
  after insert or update of status on tramites
  for each row execute function cobro_from_tramite();

-- Productos que ya estaban resueltos
insert into cobros (lead_id, tramite_id, servicio, asesor_id, monto_servicio, comision, fecha_servicio)
select t.lead_id, t.id, t.tipo, coalesce(t.assigned_to, l.assigned_to), p.precio, coalesce(p.comision, 0), t.updated_at::date
from tramites t
join leads l on l.id = t.lead_id
left join products p on lower(p.name) = lower(t.tipo)
where t.status = 'resuelto'
on conflict (tramite_id) do nothing;
