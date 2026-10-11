-- Phase 1: schema, RLS and storage for the document extraction platform.

create extension if not exists pgcrypto;

-- Tenancy ---------------------------------------------------------------
create table orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table org_members (
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('member', 'reviewer', 'admin')),
  primary key (org_id, user_id)
);

-- Orgs the current user belongs to. security definer avoids RLS recursion.
create function public.user_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from org_members where user_id = auth.uid()
$$;

-- Every new user gets a personal org.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare new_org uuid;
begin
  insert into orgs (name) values (coalesce(new.email, 'Personal')) returning id into new_org;
  insert into org_members (org_id, user_id, role) values (new_org, new.id, 'admin');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function public.handle_new_user();

-- Documents -------------------------------------------------------------
create type document_status as enum (
  'uploaded', 'normalised', 'ocr_done', 'extracted', 'cross_checked',
  'validated', 'tokenised', 'ready_for_review', 'submitted', 'failed'
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) default auth.uid(),
  org_id uuid not null references orgs(id),
  filename text not null,
  storage_path text not null,
  mime_type text not null,
  size_bytes bigint not null,
  file_hash text,
  status document_status not null default 'uploaded',
  doc_type text,
  page_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on documents (org_id, created_at desc);
create index on documents (file_hash);

create table pages (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  org_id uuid not null references orgs(id),
  page_no int not null,
  markdown text,
  image_path text,
  unique (document_id, page_no)
);

create table fields (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  org_id uuid not null references orgs(id),
  key text not null,
  label text not null,
  type text not null,
  is_cost boolean not null default false,
  page_no int,
  bbox jsonb,
  value text,
  confidence real check (confidence between 0 and 1),
  validation_status text not null default 'pending'
    check (validation_status in ('pending', 'valid', 'invalid')),
  validation_errors jsonb,
  is_draft boolean not null default true,
  version int not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (document_id, key)
);

create table field_options (
  id uuid primary key default gen_random_uuid(),
  field_id uuid not null references fields(id) on delete cascade,
  org_id uuid not null references orgs(id),
  value text not null,
  source text not null,
  confidence real,
  cost_minor bigint,
  currency char(3),
  score real,
  is_recommended boolean not null default false,
  rationale text
);

create table pii_vault (
  token text primary key,
  org_id uuid not null references orgs(id),
  type text not null check (type in ('email', 'phone')),
  encrypted_value bytea not null,
  document_id uuid references documents(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references orgs(id),
  actor_id uuid references auth.users(id),
  action text not null,
  entity text not null,
  entity_id text,
  diff jsonb,
  created_at timestamptz not null default now()
);

create table processing_jobs (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents(id) on delete cascade,
  org_id uuid not null references orgs(id),
  stage text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'done', 'failed')),
  attempts int not null default 0,
  error text,
  updated_at timestamptz not null default now()
);

create table scoring_config (
  org_id uuid primary key references orgs(id) on delete cascade,
  weights jsonb not null default
    '{"agreement":0.4,"reference_match":0.25,"validity":0.2,"confidence":0.15}'
);

-- updated_at maintenance ------------------------------------------------
create function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create trigger documents_touch before update on documents
  for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on processing_jobs
  for each row execute function public.touch_updated_at();

-- Row Level Security ----------------------------------------------------
alter table orgs enable row level security;
alter table org_members enable row level security;
alter table documents enable row level security;
alter table pages enable row level security;
alter table fields enable row level security;
alter table field_options enable row level security;
alter table pii_vault enable row level security;       -- no policies: service role only
alter table audit_log enable row level security;
alter table processing_jobs enable row level security;
alter table scoring_config enable row level security;

create policy orgs_read on orgs for select using (id in (select public.user_org_ids()));
create policy members_read on org_members for select using (org_id in (select public.user_org_ids()));

create policy documents_read on documents for select using (org_id in (select public.user_org_ids()));
create policy documents_insert on documents for insert
  with check (owner_id = auth.uid() and org_id in (select public.user_org_ids()));
create policy documents_update on documents for update
  using (org_id in (select public.user_org_ids()));

create policy pages_read on pages for select using (org_id in (select public.user_org_ids()));
create policy fields_read on fields for select using (org_id in (select public.user_org_ids()));
create policy fields_update on fields for update using (org_id in (select public.user_org_ids()));
create policy options_read on field_options for select using (org_id in (select public.user_org_ids()));
create policy options_update on field_options for update using (org_id in (select public.user_org_ids()));
create policy jobs_read on processing_jobs for select using (org_id in (select public.user_org_ids()));
create policy audit_read on audit_log for select using (org_id in (select public.user_org_ids()));
create policy scoring_read on scoring_config for select using (org_id in (select public.user_org_ids()));

-- Realtime for live stage progress.
alter publication supabase_realtime add table documents, processing_jobs;

-- Storage: private bucket, objects under {org_id}/{document_id}/original.ext
insert into storage.buckets (id, name, public, file_size_limit)
values ('documents', 'documents', false, 26214400)
on conflict (id) do nothing;

create policy documents_bucket_read on storage.objects for select
  using (bucket_id = 'documents'
         and (storage.foldername(name))[1]::uuid in (select public.user_org_ids()));
