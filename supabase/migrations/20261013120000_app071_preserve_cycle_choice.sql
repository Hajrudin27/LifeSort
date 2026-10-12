-- APP-071 / ADR-0059. Data-only; no schema, RLS or grant change.
--
-- Cyklus er et helbredsmodul, og et helbredsmodul uden et gemt valg er fra nu af slået FRA (ADR-0059).
-- Indtil nu var standarden "til", så en bruger der aldrig har svaret kunne se Cyklus uden selv at have valgt
-- det. Når standarden vendes, skal den, der allerede BRUGER Cyklus, ikke pludselig miste fanen.
--
-- Beviset for brug er, at der findes cyklusdata på serveren: mindst én række i cycles, symptom_logs eller
-- cycle_settings. Kun for dem — og kun hvis der ikke allerede findes en cycle-række i user_modules — gemmes
-- brugerens hidtidige synlighed som et eksplicit valg (enabled = true).
--
-- Det migrationen IKKE gør:
--   * Den læser aldrig profiles.gender. Køn afgør ikke noget modul (ADR-0016).
--   * Den slår ikke Cyklus til for alle uden en række. Fravær af svar og fravær af data er ikke et valg.
--   * Den rører ikke en eksisterende række — hverken true eller false. Et gemt valg vinder altid.
--   * Den kopierer ingen helbredsdata: kun user_id, modul-id og et boolsk valg skrives.
--   * Den ændrer og sletter ikke noget i cycles, symptom_logs eller cycle_settings.
--
-- Idempotent: en række der er indsat, findes ved næste kørsel, og `not exists` samt `on conflict do nothing`
-- gør den anden kørsel til en ingenting. revision/updated_at sættes af triggeren fra APP-033, som for enhver
-- anden INSERT.

insert into public.user_modules (user_id, module_id, enabled)
select evidence.user_id, 'cycle', true
  from (
         select user_id from public.cycles
         union
         select user_id from public.symptom_logs
         union
         select user_id from public.cycle_settings
       ) as evidence
 where not exists (
         select 1
           from public.user_modules um
          where um.user_id = evidence.user_id
            and um.module_id = 'cycle'
       )
on conflict (user_id, module_id) do nothing;
