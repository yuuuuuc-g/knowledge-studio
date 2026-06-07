-- Knowledge Studio Supabase storage schema.
-- Run this once in Supabase SQL Editor.

create table if not exists public.knowledge_resources (
  id text primary key,
  resource jsonb not null,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists knowledge_resources_set_updated_at on public.knowledge_resources;
create trigger knowledge_resources_set_updated_at
before update on public.knowledge_resources
for each row
execute function public.set_updated_at();

alter table public.knowledge_resources enable row level security;

insert into storage.buckets (id, name, public)
values ('knowledge-resource-files', 'knowledge-resource-files', false)
on conflict (id) do nothing;

-- The API server uses SUPABASE_SERVICE_ROLE_KEY, so it bypasses RLS.
-- Do not expose the service role key in frontend code.
