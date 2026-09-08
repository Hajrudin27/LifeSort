create or replace view public.distinct_stores 
with (security_invoker = true) as
select distinct store from public.global_standard_prices order by store;
