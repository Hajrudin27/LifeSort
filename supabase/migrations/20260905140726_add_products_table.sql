create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);
alter table public.products enable row level security;
create policy "Authenticated users can read products"
  on public.products for select to authenticated using (true);
create policy "Admins can insert products"
  on public.products for insert to authenticated
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can update products"
  on public.products for update to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()))
  with check (exists (select 1 from public.admin_users where id = auth.uid()));
create policy "Admins can delete products"
  on public.products for delete to authenticated
  using (exists (select 1 from public.admin_users where id = auth.uid()));
-- Opret ét produkt pr. unikt (normaliseret) eksisterende produktnavn
insert into public.products (name)
select distinct on (lower(trim(product_name))) trim(product_name)
from public.global_standard_prices
order by lower(trim(product_name)), product_name;
-- Tilføj product_id, og udfyld den ud fra det gamle tekstfelt
alter table public.global_standard_prices add column if not exists product_id uuid references public.products(id) on delete cascade;
update public.global_standard_prices gsp
set product_id = p.id
from public.products p
where lower(trim(gsp.product_name)) = lower(trim(p.name));
-- Gør obligatorisk, og fjern det gamle tekstfelt
alter table public.global_standard_prices alter column product_id set not null;
alter table public.global_standard_prices drop column product_name;
-- Sørg for at et tilbud altid forsvinder, hvis prisen bag det bliver slettet
alter table public.global_offers drop constraint if exists global_offers_standard_price_id_fkey;
alter table public.global_offers add constraint global_offers_standard_price_id_fkey
  foreign key (standard_price_id) references public.global_standard_prices(id) on delete cascade;
