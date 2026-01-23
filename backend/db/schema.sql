-- Enable necessary extensions
create extension if not exists "pgcrypto";

-- CHATS TABLE
create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

-- MESSAGES TABLE
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  -- Increased constraint to 50k to handle long legal drafts/JSON outputs
  content text not null check (length(content) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null
);

-- AUDIT LOGS TABLE
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  target_id uuid null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- INDEXES for Performance
create index if not exists idx_chats_user_id on public.chats(user_id);
create index if not exists idx_messages_chat_id on public.messages(chat_id);
create index if not exists idx_messages_created_at on public.messages(created_at);
create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id);

-- ROW LEVEL SECURITY (RLS)
alter table public.chats enable row level security;
alter table public.messages enable row level security;
alter table public.audit_logs enable row level security;

-- POLICIES

-- 1. Chats Policy: Full CRUD for owner
create policy "Users can access own chats"
  on public.chats
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 2. Messages Policy: Full CRUD if user owns the parent chat
create policy "Users can access own messages"
  on public.messages
  for all
  using (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.chats c
      where c.id = messages.chat_id
        and c.user_id = auth.uid()
    )
  );

-- 3. Audit Logs Policy: Read-only for owner (Inserts handled by Service Role)
create policy "Users can access own audit logs"
  on public.audit_logs
  for select
  using (auth.uid() = user_id);