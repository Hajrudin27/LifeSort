/**
 * Sessioner på tværs af enheder (APP-025).
 *
 * Supabase' klient kan tre ting med en afmelding, og forskellen betyder noget
 * for brugeren:
 *
 *   local   — kun den her enhed. Det almindelige "log ud".
 *   others  — alle andre enheder, men ikke den her. Værktøjet, når man har
 *             glemt at logge ud på en lånt computer.
 *   global  — alle, inklusive den her.
 *
 * Bemærk: Supabase' standard er `global`. Appen loggede derfor tidligere
 * brugeren ud af ALLE sine enheder, hver gang hun trykkede "log ud" på
 * telefonen — uden at bede om det og uden at sige det. Det almindelige log ud
 * er nu `local`, og de to andre er handlinger, man vælger med vilje.
 */

export type SessionScope = 'local' | 'others' | 'global';

/**
 * Skal den lokale oprydning køre bagefter?
 *
 * Ren funktion, fordi svaret afgør, om brugerens data bliver liggende på
 * telefonen. 'others' rører ikke den her enhed — kører man oprydningen der,
 * ville man logge sig selv ud af en handling, der udtrykkeligt handlede om de
 * andre.
 */
export function scopeAffectsThisDevice(scope: SessionScope): boolean {
  return scope !== 'others';
}

/** Kan appen vise en liste over aktive enheder? */
export const CAN_LIST_SESSIONS = false;

/**
 * Hvorfor ikke: Supabase' klient-SDK udstiller ingen liste over en brugers
 * sessioner. Kun admin-API'et kan det, og det kræver servicenøglen, som aldrig
 * må ligge i en app. En liste ville derfor kræve en Edge Function, der spørger
 * på brugerens vegne — det er en selvstændig opgave med sin egen
 * autorisationsflade. Indtil da kan brugeren se sin egen session og lukke de
 * andre, hvilket er det, en liste alligevel skulle bruges til.
 */
export const SESSION_LIST_LIMITATION =
  'Supabase-klienten kan ikke liste sessioner; kun admin-API\'et kan, og det kræver servicenøglen.';
