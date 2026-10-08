-- ============================================================
-- Личный планер: задачи, заметки, встречи.
-- Пользователь идентифицируется Telegram ID (bigint).
--
-- Авторизация Mini App: Edge Function auth-verify проверяет подпись
-- initData и выпускает JWT с клеймами:
--   { "sub": "<tg_id>", "tg_id": <число>, "role": "authenticated" }
-- Подпись — секрет APP_JWT_SECRET (значение — Legacy JWT Secret проекта).
--
-- RLS: строка видна/меняется только если tg_id из JWT == user_id.
-- Edge Function'ы пишут через service role (RLS обходится осознанно:
-- user_id берётся из проверенного источника, а не из запроса).
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- Задачи ----------
create table public.tasks (
  id           uuid primary key default gen_random_uuid(),
  user_id      bigint not null,
  title        text   not null,
  due_date     date,                                -- null = без даты
  done         boolean not null default false,
  source       text   not null default 'manual',    -- manual | voice | shortcut
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- ---------- Заметки ----------
create table public.notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    bigint not null,
  body       text   not null,
  source     text   not null default 'manual',
  created_at timestamptz not null default now()
);

-- ---------- Встречи ----------
create table public.meetings (
  id         uuid primary key default gen_random_uuid(),
  user_id    bigint not null,
  title      text   not null,
  -- «Наивное» локальное время пользователя (timestamp без зоны): личный
  -- планер живёт в одной таймзоне, так что храним и показываем как есть.
  starts_at  timestamp not null,
  ends_at    timestamp,
  note       text,
  source     text   not null default 'manual',
  created_at timestamptz not null default now()
);

-- ---------- Сырые голосовые расшифровки (аудит того, как LLM разобрал фразу) ----------
create table public.captures (
  id         uuid primary key default gen_random_uuid(),
  user_id    bigint not null,
  transcript text   not null,
  source     text   not null,                       -- voice | shortcut
  parsed     jsonb,
  created_at timestamptz not null default now()
);

-- Индексы под запросы интерфейса
create index tasks_user_open_due_idx  on public.tasks    (user_id, due_date) where done = false;
create index notes_user_created_idx   on public.notes    (user_id, created_at desc);
create index meetings_user_starts_idx on public.meetings (user_id, starts_at);

-- ---------- RLS ----------
alter table public.tasks    enable row level security;
alter table public.notes    enable row level security;
alter table public.meetings enable row level security;
alter table public.captures enable row level security;

create policy tasks_owner    on public.tasks    for all
  using (user_id = (auth.jwt() ->> 'tg_id')::bigint)
  with check (user_id = (auth.jwt() ->> 'tg_id')::bigint);

create policy notes_owner    on public.notes    for all
  using (user_id = (auth.jwt() ->> 'tg_id')::bigint)
  with check (user_id = (auth.jwt() ->> 'tg_id')::bigint);

create policy meetings_owner on public.meetings for all
  using (user_id = (auth.jwt() ->> 'tg_id')::bigint)
  with check (user_id = (auth.jwt() ->> 'tg_id')::bigint);

create policy captures_owner on public.captures for all
  using (user_id = (auth.jwt() ->> 'tg_id')::bigint)
  with check (user_id = (auth.jwt() ->> 'tg_id')::bigint);

-- ---------- Realtime (мгновенное обновление Digest при голосовой записи) ----------
alter table public.tasks    replica identity full;
alter table public.notes    replica identity full;
alter table public.meetings replica identity full;

do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null; end $$;

do $$ begin
  alter publication supabase_realtime add table public.meetings;
exception when duplicate_object then null; end $$;
