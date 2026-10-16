-- Asesor por trámite: cada producto del prospecto puede llevarlo un asesor distinto.
-- leads.assigned_to queda como asesor principal y se usa cuando el trámite no tiene uno propio.
-- Ejecutar en Supabase: SQL Editor → pegar → Run

alter table tramites add column if not exists assigned_to uuid references profiles(id) on delete set null;

-- Los trámites abiertos heredan el asesor que ya tenía el prospecto
update tramites t
set assigned_to = l.assigned_to
from leads l
where t.lead_id = l.id
  and t.assigned_to is null
  and l.assigned_to is not null
  and t.status not in ('resuelto', 'rechazado', 'cancelado');
