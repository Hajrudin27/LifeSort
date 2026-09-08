import { getModule, type ModuleId } from '@/core/modules/moduleRegistry';

/**
 * App-låsens rolle og grænser (APP-026).
 *
 * Låsen beskytter ENHEDEN, ikke kontoen. Den holder en, der samler telefonen
 * op, ude af det, der allerede ligger på den. Den beviser ingenting over for
 * serveren, og den må aldrig stå mellem en bruger og noget, serveren selv skal
 * kontrollere — se ADR-0007 og ADR-0018.
 *
 * Derfor er den også valgfri. En lås, brugeren ikke har valgt, ville bare være
 * en dør, hun ikke har nøglen til.
 */

/**
 * De følsomheder, der får os til at anbefale låsen.
 *
 * Kun helbred. Et beløb på skærmen er ubehageligt at få kigget på; en cyklusdag
 * fortæller noget, brugeren aldrig selv har valgt at sige. Anbefalede vi låsen
 * ved enhver form for følsomhed, ville næsten hvert modul udløse den, og så
 * ville anbefalingen holde op med at betyde noget.
 */
export const LOCK_RECOMMENDED_SENSITIVITIES = ['health'] as const;

export function moduleWantsAppLock(moduleId: ModuleId): boolean {
  return getModule(moduleId).sensitivity.some((value) =>
    (LOCK_RECOMMENDED_SENSITIVITIES as readonly string[]).includes(value),
  );
}

export type AppLockRecommendation = {
  lockEnabled: boolean;
  enabledModuleIds: readonly ModuleId[];
  /** Brugeren har set anbefalingen og valgt den fra. */
  dismissed: boolean;
};

/**
 * Skal vi foreslå låsen?
 *
 * Kun når der er noget at beskytte, låsen er slået fra, og brugeren ikke
 * allerede har sagt nej. Et forslag, der bliver ved med at komme igen, er en
 * påmindelse, folk lærer at klikke væk.
 */
export function shouldRecommendAppLock({
  lockEnabled,
  enabledModuleIds,
  dismissed,
}: AppLockRecommendation): boolean {
  if (lockEnabled || dismissed) return false;
  return enabledModuleIds.some(moduleWantsAppLock);
}
