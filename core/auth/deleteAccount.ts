import { LOCAL_STORE_RESETS } from '@/features/localStores';
import { supabase } from '@/lib/supabase';

import { clearLocalUserData } from './clearLocalUserData';

/**
 * Sletning af konto og alt indhold (APP-022).
 *
 * Rækkefølgen er ikke til forhandling. Filerne i Storage skal fjernes FØR
 * kontoen, for bagefter findes den session, der har lov til at røre dem, ikke
 * længere: policyen tillader kun en bruger at slette sine egne filer, og "sine
 * egne" er defineret ud fra en bruger, der lige er blevet slettet.
 *
 * Stierne læses fra attachments-tabellen frem for at liste bucket'en, fordi
 * filerne ligger i indlejrede mapper og tabellen ved præcis hvor.
 *
 * Konsekvensen af den rækkefølge er værd at kende: fejler selve sletningen af
 * kontoen, er filerne allerede væk. Derfor melder funktionen tilbage, hvor den
 * nåede til — brugeren skal kunne se, hvad der faktisk skete, frem for kun at
 * få at vide at "noget gik galt".
 */

export type DeleteAccountStage = 'files' | 'account' | 'local';

export type DeleteAccountResult =
  | { ok: true }
  | {
      ok: false;
      /** 'admin_account' kan brugeren gøre noget ved; resten er systemfejl. */
      reason: 'not_authenticated' | 'admin_account' | 'unknown';
      /** Hvor langt vi nåede. Afgør hvad der er sandt at sige til brugeren. */
      failedAt: DeleteAccountStage;
      /** Om filerne allerede var slettet, da det gik galt. */
      filesAlreadyDeleted: boolean;
    };

const BUCKET = 'attachments';

export async function deleteAccount(
  onStage?: (stage: DeleteAccountStage) => void,
): Promise<DeleteAccountResult> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;

  if (!userId) {
    return { ok: false, reason: 'not_authenticated', failedAt: 'files', filesAlreadyDeleted: false };
  }

  // 1. Filerne.
  onStage?.('files');
  let filesAlreadyDeleted = false;

  const { data: rows } = await supabase.from('attachments').select('storage_path').eq('user_id', userId);

  const paths = (rows ?? [])
    .map((row: { storage_path: string | null }) => row.storage_path)
    .filter((storagePath): storagePath is string => Boolean(storagePath));

  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
    filesAlreadyDeleted = true;
  }

  // 2. Kontoen. Alle bruger-tabeller har ON DELETE CASCADE fra auth.users, så
  // ét kald fjerner hele indholdet — uden en liste over tabeller, der ville
  // blive forældet, næste gang der kommer en ny til.
  onStage?.('account');
  const { error } = await supabase.rpc('delete_my_account');

  if (error) {
    const message = error.message ?? '';
    const reason = message.includes('admin_account')
      ? 'admin_account'
      : message.includes('not_authenticated')
        ? 'not_authenticated'
        : 'unknown';
    return { ok: false, reason, failedAt: 'account', filesAlreadyDeleted };
  }

  // 3. Enheden. Kontoen er væk nu, så det lokale SKAL ryddes, også hvis
  // afmeldingen driller — ellers ligger en slettet brugers data tilbage på
  // telefonen. Derfor ingen tidlig retur her.
  onStage?.('local');
  try {
    // Udtrykkeligt scope, som alle andre steder (ADR-0019). Her er `global`
    // det rigtige: kontoen findes ikke længere, så enhver session på enhver
    // enhed er alligevel ugyldig — og ingen af dem skal ligge og vente.
    await supabase.auth.signOut({ scope: 'global' });
  } catch {
    // Sessionen er alligevel ugyldig nu.
  }
  await clearLocalUserData(LOCAL_STORE_RESETS);

  return { ok: true };
}
