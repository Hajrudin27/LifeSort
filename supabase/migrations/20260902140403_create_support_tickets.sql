create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  status text not null default 'open',
  admin_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.support_tickets enable row level security;