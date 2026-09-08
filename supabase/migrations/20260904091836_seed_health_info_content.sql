-- Symptomordbog
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('cramps', 'Kramper', 'Cramps', 'Kramper i underlivet skyldes typisk livmoderens sammentrækninger under menstruation, drevet af hormonlignende stoffer kaldet prostaglandiner. Milde til moderate kramper er almindelige, men kraftige, invaliderende kramper bør undersøges.', 'Abdominal cramps are typically caused by uterine contractions during menstruation, driven by hormone-like substances called prostaglandins. Mild to moderate cramps are common, but severe, debilitating cramps should be evaluated.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('headache', 'Hovedpine', 'Headache', 'Hovedpine omkring menstruation kan hænge sammen med hormonelle udsving, særligt fald i østrogen. For nogle er det et fast, forudsigeligt mønster i cyklussen.', 'Headaches around menstruation can be linked to hormonal fluctuations, particularly a drop in estrogen. For some, it''s a consistent, predictable pattern in the cycle.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('bloating', 'Oppustethed', 'Bloating', 'Oppustethed skyldes ofte væskeophobning påvirket af hormonelle ændringer i ugen før menstruation, og aftager typisk, når menstruationen starter.', 'Bloating is often caused by fluid retention influenced by hormonal changes in the week before your period, and typically eases once your period starts.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('fatigue', 'Træthed', 'Fatigue', 'Træthed omkring menstruation kan skyldes en kombination af hormonelle udsving, søvnforstyrrelser og — ved kraftig blødning — lavere jernniveau.', 'Fatigue around menstruation can result from a combination of hormonal fluctuations, sleep disruption, and — with heavy bleeding — lower iron levels.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('moodSwings', 'Humørsvingninger', 'Mood swings', 'Humørsvingninger i den luteale fase menes at hænge sammen med udsving i østrogen og progesteron, som påvirker signalstoffer i hjernen.', 'Mood swings in the luteal phase are thought to be linked to fluctuations in estrogen and progesterone, which affect brain chemistry.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('acne', 'Uren hud', 'Acne', 'Uren hud omkring menstruation kan skyldes hormonelle udsving, der øger talgproduktionen i huden.', 'Skin breakouts around menstruation can be caused by hormonal fluctuations that increase skin oil production.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('backache', 'Rygsmerter', 'Backache', 'Rygsmerter under menstruation hænger ofte sammen med de samme muskelsammentrækninger, der giver underlivssmerter, og kan stråle til lænd og lår.', 'Back pain during menstruation is often linked to the same muscle contractions that cause abdominal pain, and can radiate to the lower back and thighs.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('nausea', 'Kvalme', 'Nausea', 'Kvalme omkring menstruation kan være relateret til prostaglandiner, som udover livmoderen også kan påvirke mave-tarm-systemet hos nogle.', 'Nausea around menstruation can be related to prostaglandins, which besides the uterus can also affect the digestive system in some people.');
insert into public.symptom_glossary (id, name_da, name_en, description_da, description_en) values ('tenderBreasts', 'Ømme bryster', 'Tender breasts', 'Ømme bryster før menstruation er en almindelig reaktion på hormonelle udsving og aftager typisk, når menstruationen starter.', 'Breast tenderness before menstruation is a common response to hormonal fluctuations and typically eases once your period starts.');
-- Sundhedstilstande
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'thyroidDisorders',
  'Skjoldbruskkirtelproblemer', 'Thyroid disorders',
  'For høj eller for lav aktivitet i skjoldbruskkirtlen kan påvirke cyklus.', 'Overactive or underactive thyroid can affect your cycle.',
  'Skjoldbruskkirtlen producerer hormoner, der styrer stofskiftet, og som også har indflydelse på menstruationscyklussen. Både for høj (hyperthyreose) og for lav (hypothyreose) aktivitet kan give uregelmæssig, udebleven eller kraftigere menstruation, samt påvirke energiniveau og humør.', 'The thyroid produces hormones that regulate metabolism and also influence the menstrual cycle. Both overactive (hyperthyroidism) and underactive (hypothyroidism) thyroid function can cause irregular, absent, or heavier periods, and affect energy levels and mood.',
  ARRAY['fatigue','moodSwings']::text[],
  'Behandling afhænger af, om aktiviteten er for høj eller for lav, og involverer typisk medicin fastsat af en læge efter blodprøver.', 'Treatment depends on whether the thyroid is over- or underactive, and typically involves medication determined by a doctor after blood tests.',
  'Kontakt din læge, hvis du oplever vedvarende træthed, uforklarlige vægtændringer, eller markante ændringer i din cyklus, du ikke kan forklare.', 'See your doctor if you experience persistent fatigue, unexplained weight changes, or significant changes to your cycle you can''t explain.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'anemia',
  'Jernmangelanæmi', 'Iron-deficiency anemia',
  'Lavt jerniveau, ofte forbundet med kraftig menstruationsblødning.', 'Low iron levels, often linked to heavy menstrual bleeding.',
  'Jernmangelanæmi opstår, når kroppen ikke har nok jern til at danne røde blodlegemer. Kraftig eller langvarig menstruationsblødning er en almindelig årsag hos kvinder, fordi det tab af blod over tid kan tømme kroppens jernlagre.', 'Iron-deficiency anemia occurs when the body doesn''t have enough iron to produce red blood cells. Heavy or prolonged menstrual bleeding is a common cause in women, as the ongoing blood loss can deplete the body''s iron stores over time.',
  ARRAY['fatigue','headache']::text[],
  'Behandling kan omfatte jerntilskud og, hvor relevant, håndtering af den bagvedliggende årsag til blodtabet — begge dele bør vurderes af en læge.', 'Treatment may include iron supplements and, where relevant, addressing the underlying cause of blood loss — both should be assessed by a doctor.',
  'Kontakt din læge, hvis du oplever vedvarende træthed, bleghed, åndenød ved almindelig aktivitet, eller ved kraftig menstruationsblødning.', 'See your doctor if you experience persistent fatigue, paleness, shortness of breath during normal activity, or heavy menstrual bleeding.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'ovarianCysts',
  'Cyster på æggestokkene', 'Ovarian cysts',
  'Væskefyldte hulrum på æggestokken, ofte uden symptomer.', 'Fluid-filled sacs on the ovary, often without symptoms.',
  'Cyster på æggestokkene er væskefyldte hulrum, der kan opstå som en naturlig del af ægløsningen. De fleste er godartede og forsvinder af sig selv, men nogle kan give smerter, oppustethed eller uregelmæssig cyklus, særligt hvis de bliver store.', 'Ovarian cysts are fluid-filled sacs that can form as a natural part of ovulation. Most are benign and resolve on their own, but some can cause pain, bloating, or irregular cycles, particularly if they grow large.',
  ARRAY['cramps','bloating','backache']::text[],
  'De fleste cyster kræver ingen behandling og overvåges blot. Ved vedvarende eller store cyster kan behandling omfatte hormonel regulering eller i sjældnere tilfælde kirurgi.', 'Most cysts require no treatment and are simply monitored. For persistent or large cysts, treatment may include hormonal regulation or, in rarer cases, surgery.',
  'Kontakt din læge ved pludselige, kraftige smerter i underlivet, eller hvis du oplever vedvarende oppustethed eller uregelmæssig cyklus.', 'See your doctor for sudden, severe pelvic pain, or if you experience persistent bloating or an irregular cycle.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'endometriosis',
  'Endometriose', 'Endometriosis',
  'Kronisk tilstand hvor væv, der ligner livmoderslimhinden, vokser uden for livmoderen.', 'A chronic condition where tissue similar to the uterine lining grows outside the uterus.',
  'Endometriose er en kronisk tilstand, hvor væv, der minder om livmoderslimhinden, vokser andre steder i kroppen — typisk på æggestokkene, æggelederne eller bækkenets bindevæv. Dette væv reagerer på samme måde som livmoderslimhinden under cyklussen, hvilket kan give betændelse, smerte og arvæv over tid. Tilstanden rammer et betydeligt antal kvinder i den fødedygtige alder.', 'Endometriosis is a chronic condition where tissue similar to the lining of the uterus grows elsewhere in the body — typically on the ovaries, fallopian tubes, or pelvic connective tissue. This tissue responds to the menstrual cycle the same way the uterine lining does, which can cause inflammation, pain, and scar tissue over time. It affects a significant number of women of reproductive age.',
  ARRAY['cramps','backache','fatigue','nausea']::text[],
  'Behandling afhænger af sværhedsgrad og ønske om graviditet, og spænder fra smertestillende medicin og hormonel behandling til kirurgi. Varme, regelmæssig bevægelse og stresshåndtering nævnes ofte som noget, der kan lindre symptomer for nogle, men erstatter ikke lægelig behandling.', 'Treatment depends on severity and pregnancy goals, ranging from pain relief and hormonal treatment to surgery. Heat, regular movement, and stress management are often mentioned as helpful for some, but do not replace medical treatment.',
  'Kontakt din læge, hvis du oplever kraftige menstruationssmerter, der påvirker din hverdag, smerter under samleje, eller hvis smerterne forværres over tid.', 'See your doctor if you experience severe period pain that affects your daily life, pain during intercourse, or if pain worsens over time.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'pcos',
  'PCOS (Polycystisk ovariesyndrom)', 'PCOS (Polycystic Ovary Syndrome)',
  'Hormonel tilstand der kan påvirke menstruationscyklus, hud og fertilitet.', 'A hormonal condition that can affect the menstrual cycle, skin, and fertility.',
  'PCOS er en hormonel tilstand, hvor æggestokkene kan producere flere mandlige kønshormoner end normalt. Det kan give uregelmæssig eller udebleven menstruation, cyster på æggestokkene, og påvirke hud og hårvækst. PCOS er en af de hyppigste hormonelle tilstande hos kvinder i den fødedygtige alder.', 'PCOS is a hormonal condition where the ovaries may produce higher levels of male hormones than usual. It can cause irregular or absent periods, cysts on the ovaries, and affect skin and hair growth. PCOS is one of the most common hormonal conditions in women of reproductive age.',
  ARRAY['acne','moodSwings','fatigue']::text[],
  'Behandling kan omfatte livsstilsændringer (kost, motion), hormonel prævention for at regulere cyklussen, eller specifik medicin afhængigt af symptomer og ønsker om graviditet.', 'Treatment may include lifestyle changes (diet, exercise), hormonal contraception to regulate the cycle, or specific medication depending on symptoms and pregnancy goals.',
  'Kontakt din læge, hvis din menstruation er meget uregelmæssig eller udebliver i flere måneder, eller hvis du oplever uventet hårvækst, vægtændringer eller uren hud, du er bekymret for.', 'See your doctor if your period is very irregular or absent for several months, or if you notice unexpected hair growth, weight changes, or skin changes that concern you.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'pms',
  'PMS (Præmenstruelt syndrom)', 'PMS (Premenstrual Syndrome)',
  'Fysiske og følelsesmæssige symptomer i ugen(erne) før menstruation.', 'Physical and emotional symptoms in the week(s) before your period.',
  'PMS dækker over en bred vifte af fysiske og følelsesmæssige symptomer, der typisk opstår i den luteale fase (efter ægløsning, før menstruation) og forsvinder, når menstruationen starter. Det menes at hænge sammen med hormonelle udsving i denne del af cyklussen.', 'PMS covers a wide range of physical and emotional symptoms that typically appear in the luteal phase (after ovulation, before your period) and resolve once your period starts. It''s thought to be linked to hormonal fluctuations during this part of the cycle.',
  ARRAY['moodSwings','bloating','tenderBreasts','headache']::text[],
  'Regelmæssig søvn, motion, en afbalanceret kost og stresshåndtering nævnes ofte som støttende. Nogle oplever lindring af håndkøbssmertestillende midler ved fysiske symptomer.', 'Regular sleep, exercise, a balanced diet, and stress management are often mentioned as supportive. Some find relief from over-the-counter pain relief for physical symptoms.',
  'Kontakt din læge, hvis symptomerne er så kraftige, at de forstyrrer din dagligdag, arbejde eller relationer.', 'See your doctor if symptoms are severe enough to disrupt your daily life, work, or relationships.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'pmdd',
  'PMDD (Præmenstruel dysforisk lidelse)', 'PMDD (Premenstrual Dysphoric Disorder)',
  'En mere alvorlig form for PMS med udtalte følelsesmæssige symptomer.', 'A more severe form of PMS with pronounced emotional symptoms.',
  'PMDD er en mere alvorlig variant af PMS, kendetegnet ved markante humørsvingninger, irritabilitet, angst eller nedtrykthed i ugerne før menstruation. Symptomerne er kraftige nok til at påvirke daglig funktion markant, og adskiller sig fra almindelig PMS i intensitet.', 'PMDD is a more severe variant of PMS, marked by significant mood swings, irritability, anxiety, or low mood in the weeks before your period. Symptoms are severe enough to noticeably affect daily functioning, differing from typical PMS in intensity.',
  ARRAY['moodSwings','fatigue','bloating']::text[],
  'Behandling kan omfatte terapi, hormonel behandling eller anden medicin, afhængigt af den enkeltes situation — dette bør altid vurderes af en læge.', 'Treatment may include therapy, hormonal treatment, or other medication depending on the individual situation — this should always be assessed by a doctor.',
  'Kontakt din læge, hvis du oplever kraftige humørmæssige symptomer måned efter måned, der påvirker dit arbejde, relationer eller trivsel.', 'See your doctor if you experience severe mood-related symptoms month after month that affect your work, relationships, or wellbeing.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'dysmenorrhea',
  'Dysmenoré (smertefuld menstruation)', 'Dysmenorrhea (painful periods)',
  'Kraftige kramper eller smerter i forbindelse med menstruation.', 'Severe cramps or pain associated with menstruation.',
  'Dysmenoré betyder smertefuld menstruation og dækker over kramper i underlivet, ofte ledsaget af smerter i lænd og lår. Det kan enten være ''primær'' (uden underliggende årsag) eller ''sekundær'' (forårsaget af en anden tilstand, fx endometriose).', 'Dysmenorrhea means painful periods and covers cramping in the lower abdomen, often accompanied by pain in the lower back and thighs. It can be either ''primary'' (without an underlying cause) or ''secondary'' (caused by another condition, e.g. endometriosis).',
  ARRAY['cramps','backache','nausea']::text[],
  'Varme (varmepude), håndkøbssmertestillende midler, og let bevægelse nævnes ofte som lindrende for milde til moderate smerter.', 'Heat (a heating pad), over-the-counter pain relief, and light movement are often mentioned as soothing for mild to moderate pain.',
  'Kontakt din læge, hvis smerterne er så kraftige, at de forhindrer dig i dagligdags aktiviteter, eller hvis de pludselig bliver værre end normalt.', 'See your doctor if pain is severe enough to prevent daily activities, or if it suddenly becomes worse than usual.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'menorrhagia',
  'Menoragi (kraftig menstruationsblødning)', 'Menorrhagia (heavy menstrual bleeding)',
  'Unormalt kraftig eller langvarig menstruationsblødning.', 'Abnormally heavy or prolonged menstrual bleeding.',
  'Menoragi betegner en menstruation, der er markant kraftigere eller varer længere end normalt, og som kan påvirke dagligdagen betydeligt. Det kan skyldes flere forskellige underliggende årsager og bør altid undersøges.', 'Menorrhagia refers to a period that is significantly heavier or lasts longer than normal, and can significantly affect daily life. It can have several different underlying causes and should always be investigated.',
  ARRAY['fatigue','cramps']::text[],
  'Behandling afhænger af årsagen og kan omfatte medicin eller andre indgreb — dette skal vurderes af en læge.', 'Treatment depends on the cause and may include medication or other interventions — this should be assessed by a doctor.',
  'Kontakt din læge, hvis du skal skifte bind/tampon hver time i flere timer i træk, oplever store blodpropper, eller føler dig usædvanligt træt eller svimmel.', 'See your doctor if you need to change your pad/tampon every hour for several hours in a row, experience large blood clots, or feel unusually tired or dizzy.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'amenorrhea',
  'Amenoré (udebleven menstruation)', 'Amenorrhea (absent periods)',
  'Fravær af menstruation i en periode, hvor den forventes.', 'Absence of menstruation during a period when it''s expected.',
  'Amenoré betyder, at menstruationen udebliver. Det kan skyldes graviditet, hormonelle forandringer, kraftigt vægttab eller -tab, stress, intensiv træning, eller andre underliggende tilstande.', 'Amenorrhea means your period is absent. It can be caused by pregnancy, hormonal changes, significant weight loss or gain, stress, intensive exercise, or other underlying conditions.',
  ARRAY[]::text[],
  'Det afhænger fuldstændigt af den underliggende årsag, og bør altid afklares med en læge først.', 'It depends entirely on the underlying cause, and should always be clarified with a doctor first.',
  'Kontakt din læge, hvis din menstruation udebliver i tre måneder eller mere, og graviditet er udelukket.', 'See your doctor if your period is absent for three months or more and pregnancy is ruled out.'
);
insert into public.health_conditions (id, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en) values (
  'fibroids',
  'Myomer (godartede knuder i livmoderen)', 'Fibroids (benign growths in the uterus)',
  'Godartede knuder i eller omkring livmoderen.', 'Benign growths in or around the uterus.',
  'Myomer er godartede (ikke-kræftfremkaldende) knuder af muskel- og bindevæv, der vokser i eller omkring livmoderen. Mange kvinder har myomer uden at mærke noget, men de kan hos nogle give kraftig blødning, smerter eller tryksymptomer.', 'Fibroids are benign (non-cancerous) growths of muscle and connective tissue that grow in or around the uterus. Many women have fibroids without noticing anything, but for some they can cause heavy bleeding, pain, or pressure symptoms.',
  ARRAY['cramps','fatigue','backache']::text[],
  'Behandling afhænger af størrelse, placering og symptomer, og spænder fra ingen behandling til medicin eller kirurgi.', 'Treatment depends on size, location, and symptoms, and ranges from no treatment to medication or surgery.',
  'Kontakt din læge, hvis du oplever kraftig eller forlænget blødning, bækkensmerter, eller tryk på blæren.', 'See your doctor if you experience heavy or prolonged bleeding, pelvic pain, or pressure on your bladder.'
);
