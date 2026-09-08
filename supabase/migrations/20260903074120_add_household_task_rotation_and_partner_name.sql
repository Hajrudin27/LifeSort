alter table public.profiles add column if not exists partner_name text;
alter table public.household_tasks add column if not exists assigned_to text not null default 'me' check (assigned_to in ('me', 'partner'));
alter table public.household_tasks add column if not exists rotates boolean not null default false;
