-- =============================================================
-- CRM IMSS — esquema inicial
-- Ejecutar en Supabase: SQL Editor → pegar → Run
-- (o con la CLI: `supabase db push`)
-- =============================================================

create extension if not exists pgcrypto;

-- ---------- Enums ----------
create type lead_status as enum (
  'nuevo',                 -- llegó (formulario o primer mensaje)
  'en_conversacion',       -- hablando con el agente IA
  'registro_completo',     -- la IA ya capturó los datos requeridos
  'documentos_pendientes', -- faltan documentos
  'en_revision',           -- un asesor revisa documentos
  'en_tramite',            -- trámite iniciado ante IMSS
  'completado',
  'descartado'
);

create type message_direction as enum ('in', 'out');
create type message_sender as enum ('lead', 'ai', 'agent', 'system');
create type message_type as enum ('text', 'image', 'audio', 'document', 'video', 'location', 'other');

create type document_status as enum ('pendiente', 'procesando', 'valido', 'con_observaciones', 'invalido', 'error');

create type tramite_status as enum ('pendiente', 'en_proceso', 'en_espera_imss', 'resuelto', 'rechazado', 'cancelado');

-- ---------- Perfiles de usuarios del CRM ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  email text,
  role text not null default 'asesor' check (role in ('admin', 'asesor')),
  created_at timestamptz not null default now()
);

create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------- Leads ----------
create table leads (
  id uuid primary key default gen_random_uuid(),
  folio text unique not null default ('REG-' || upper(substr(md5(gen_random_uuid()::text), 1, 6))),
  phone text unique,                -- solo dígitos con lada país, ej. 5215512345678
  wa_chat_id text unique,           -- chatId de Green API, ej. 5215512345678@c.us
  wa_name text,                     -- nombre de perfil de WhatsApp
  full_name text,
  curp text,
  nss text,
  rfc text,
  email text,
  birth_date date,
  tramite_type text,                -- ej. pensión, modalidad 40, alta, semanas cotizadas…
  status lead_status not null default 'nuevo',
  source text not null default 'whatsapp', -- whatsapp | formulario | facebook | manual | api
  utm jsonb not null default '{}'::jsonb,  -- utm_source, utm_campaign, fbclid…
  form_data jsonb not null default '{}'::jsonb,
  captured_data jsonb not null default '{}'::jsonb, -- datos extra capturados por la IA
  ai_enabled boolean not null default true,
  needs_human boolean not null default false,
  needs_human_reason text,
  assigned_to uuid references profiles(id) on delete set null,
  notes text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  unread_count int not null default 0,
  ai_locked_until timestamptz,      -- evita que el agente responda dos veces en paralelo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index leads_status_idx on leads(status);
create index leads_last_message_idx on leads(last_message_at desc nulls last);

-- ---------- Mensajes (WhatsApp) ----------
create table messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  direction message_direction not null,
  sender message_sender not null,
  type message_type not null default 'text',
  body text,                        -- texto o caption
  transcription text,               -- para audios
  media_path text,                  -- ruta en Storage (bucket "media")
  media_mime text,
  wa_message_id text unique,        -- idMessage de Green API (deduplicación)
  status text,                      -- sent | delivered | read | failed
  sent_by uuid references profiles(id) on delete set null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index messages_lead_idx on messages(lead_id, created_at);

-- ---------- Documentos (OCR) ----------
create table documents (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  message_id uuid references messages(id) on delete set null,
  doc_type text,                    -- ine | curp | nss | comprobante_domicilio | acta_nacimiento | estado_cuenta | otro
  storage_path text not null,
  mime text,
  status document_status not null default 'pendiente',
  extracted jsonb not null default '{}'::jsonb, -- resultado OCR estructurado
  issues text[] not null default '{}',
  confidence numeric,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now()
);

create index documents_lead_idx on documents(lead_id);

-- ---------- Trámites ----------
create table tramites (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  tipo text not null,
  status tramite_status not null default 'pendiente',
  folio_imss text,
  due_date date,
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tramites_lead_idx on tramites(lead_id);

-- ---------- Bitácora / timeline ----------
create table activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  kind text not null,               -- status_change | note | document | tramite | ai | system
  content text not null,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index activities_lead_idx on activities(lead_id, created_at desc);

-- ---------- Configuración del agente IA (una sola fila) ----------
create table agent_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  agent_name text not null default 'Asistente',
  system_prompt text not null default '',
  effort text not null default 'low' check (effort in ('low', 'medium', 'high')),
  reply_delay_seconds int not null default 6,
  history_limit int not null default 40,
  updated_at timestamptz not null default now()
);

insert into agent_settings (id) values (1);

-- ---------- updated_at ----------
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger leads_touch before update on leads for each row execute function touch_updated_at();
create trigger tramites_touch before update on tramites for each row execute function touch_updated_at();
create trigger agent_settings_touch before update on agent_settings for each row execute function touch_updated_at();

-- ---------- RLS: el CRM es interno; cualquier usuario autenticado tiene acceso ----------
-- Webhooks y formulario público usan la service role key (omite RLS).
alter table profiles enable row level security;
alter table leads enable row level security;
alter table messages enable row level security;
alter table documents enable row level security;
alter table tramites enable row level security;
alter table activities enable row level security;
alter table agent_settings enable row level security;

create policy "staff all" on profiles for all to authenticated using (true) with check (true);
create policy "staff all" on leads for all to authenticated using (true) with check (true);
create policy "staff all" on messages for all to authenticated using (true) with check (true);
create policy "staff all" on documents for all to authenticated using (true) with check (true);
create policy "staff all" on tramites for all to authenticated using (true) with check (true);
create policy "staff all" on activities for all to authenticated using (true) with check (true);
create policy "staff all" on agent_settings for all to authenticated using (true) with check (true);

-- ---------- Realtime (chat en vivo e inbox) ----------
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table documents;

-- ---------- Storage: archivos de WhatsApp (privado) ----------
insert into storage.buckets (id, name, public) values ('media', 'media', false)
on conflict (id) do nothing;

create policy "staff read media" on storage.objects for select to authenticated using (bucket_id = 'media');
create policy "staff write media" on storage.objects for insert to authenticated with check (bucket_id = 'media');
