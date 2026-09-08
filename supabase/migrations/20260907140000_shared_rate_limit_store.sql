-- Delt tæller til rate limiting.
--
-- Grænserne lå i en Map i hukommelsen. På Vercel har hver lambda-instans sin egen, så
-- "5 forsøg pr. kvarter" var i praksis 5 forsøg PR. INSTANS — og instanser skaleres med
-- samtidighed, så en angriber der sender parallelt fik et mangefold. En kold start
-- nulstillede også tælleren. Det ramte hårdest på admin-login, hvor grænsen pr. konto er
-- det eneste der står mellem en kendt admin-adresse og gætteri af adgangskoden.
--
-- Tælleren flyttes derfor til databasen, som alle instanser deler i forvejen.

create table if not exists public.rate_limits (
  key      text        primary key,
  count    integer     not null,
  reset_at timestamptz not null
);
alter table public.rate_limits enable row level security;
-- Ingen policies: kun service_role, som går uden om RLS, må røre tabellen. Nøglerne
-- indeholder IP-adresser og emailadresser, så der er ingen grund til at nogen klient
-- nogensinde kan læse dem.
comment on table public.rate_limits is
  'Delte tællere til rate limiting. Kun service_role. Ryddes dagligt af purge_expired_rate_limits().';
create index if not exists rate_limits_reset_at_idx on public.rate_limits (reset_at);
/**
 * Tæl ét forsøg op og sig om det er tilladt.
 *
 * Hele operationen er ÉT statement. Et check-then-act — læs tælleren, beslut, skriv —
 * ville lade to samtidige forespørgsler læse den samme værdi og begge slippe igennem,
 * hvilket er præcis det hul en angriber med parallelle kald ville ramme. `on conflict do
 * update` tager en rækkelås, så optællingen er atomisk.
 *
 * Er vinduet udløbet, starter tælleren forfra. Ellers tælles der op uden at vinduet
 * flyttes, så en angriber ikke kan holde sig selv ude i det uendelige ved at blive ved.
 */
create or replace function public.check_rate_limit(
  p_key       text,
  p_limit     integer,
  p_window_ms integer
)
returns table (allowed boolean, remaining integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now    timestamptz := now();
  v_window interval    := make_interval(secs => p_window_ms::numeric / 1000);
  v_count  integer;
begin
  insert into public.rate_limits as r (key, count, reset_at)
  values (p_key, 1, v_now + v_window)
  on conflict (key) do update
    set count    = case when r.reset_at <= v_now then 1 else r.count + 1 end,
        reset_at = case when r.reset_at <= v_now then v_now + v_window else r.reset_at end
  returning r.count into v_count;

  return query select v_count <= p_limit, greatest(p_limit - v_count, 0);
end;
$$;
/** Nulstilling efter et vellykket login. For at nulstille skal man kende adgangskoden. */
create or replace function public.reset_rate_limit(p_key text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from public.rate_limits where key = p_key;
$$;
/**
 * Oprydning. Uden den vokser tabellen med én række pr. IP og emailadresse for altid.
 * Kaldes fra den daglige retention-opgave.
 */
create or replace function public.purge_expired_rate_limits()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limits where reset_at <= now();
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
-- Kun serveren tæller. Kunne en klient kalde dem, kunne den nulstille sin egen grænse.
revoke all on function public.check_rate_limit(text, integer, integer) from public, anon, authenticated;
revoke all on function public.reset_rate_limit(text) from public, anon, authenticated;
revoke all on function public.purge_expired_rate_limits() from public, anon, authenticated;
grant execute on function public.check_rate_limit(text, integer, integer) to service_role;
grant execute on function public.reset_rate_limit(text) to service_role;
grant execute on function public.purge_expired_rate_limits() to service_role;
