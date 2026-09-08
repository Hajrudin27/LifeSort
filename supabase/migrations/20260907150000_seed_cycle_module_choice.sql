-- APP-020 — gør den hidtidige køns-udledning til et eksplicit valg, én gang.
--
-- Indtil nu blev cyklus-fanen vist, hvis profiles.gender var 'female'. Det er
-- en udledning: appen gættede, hvilket modul en bruger havde brug for, ud fra
-- et demografisk felt. Fra nu af er det brugerens eget valg (user_modules).
--
-- Migrationen oversætter den nuværende oplevelse til det valg, så ingen
-- oplever en ændring: den, der så fanen i går, ser den i morgen, og den, der
-- ikke gjorde, får den ikke pludselig. Bagefter læses gender aldrig igen for at
-- afgøre, hvilke moduler nogen har.
--
-- Kun rækker der ikke findes i forvejen røres — har brugeren allerede valgt
-- selv, vinder hendes valg.

insert into public.user_modules (user_id, module_id, enabled)
select p.id,
       'cycle',
       coalesce(p.gender = 'female', false)
  from public.profiles p
 where not exists (
         select 1
           from public.user_modules um
          where um.user_id = p.id
            and um.module_id = 'cycle'
       );
