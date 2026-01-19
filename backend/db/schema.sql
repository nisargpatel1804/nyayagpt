create table if not exists public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null default 'New chat',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_chats_user_id on public.chats(user_id);
create index if not exists idx_messages_chat_id on public.messages(chat_id);
create index if not exists idx_messages_created_at on public.messages(created_at);

alter table public.chats enable row level security;
alter table public.messages enable row level security;

create policy "Users can access own chats"
  on public.chats
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

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
