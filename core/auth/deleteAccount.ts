import { releaseOwnDocumentsForAccountDeletion } from '@/core/documents/documentSync';
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
 * Stierne læses fra attachments- og documents-tabellerne frem for at liste
 * bucket'erne, fordi filerne ligger i indlejrede mapper og tabellerne ved
 * præcis hvor.
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

// APP-055 added a second private bucket. Storage objects do not cascade with the
// account, so every bucket the user can write to has to be swept here — leaving
// one out would quietly make the APP-022 promise false.
const DOCUMENTS_BUCKET = 'documents';

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

  // The documents half fails CLOSED. A read that did not answer is not an empty
  // account, and a `.remove()` that resolved is not a file that is gone —
  // Supabase reports refusals in `error` rather than by throwing. Continuing past
  // either one would delete the account while its documents were still in the
  // bucket, and the session that was allowed to remove them would be the thing we
  // just destroyed. The orphan sweep is a backstop, not permission to proceed
  // after a failure we already know about.
  const filesFailed = (): DeleteAccountResult =>
    ({ ok: false, reason: 'unknown', failedAt: 'files', filesAlreadyDeleted });

  // Marks this account's documents as released for deletion and hands back their
  // paths. The rows are NOT removed: they are the only record of where the
  // objects are, so destroying them before the bytes are gone would strand any
  // file whose removal failed and leave the next attempt nothing to retry with.
  // They go with the account, through the cascade, once everything else worked.
  const documentPaths = await releaseOwnDocumentsForAccountDeletion(userId);
  if (documentPaths === null) return filesFailed();

  if (documentPaths.length > 0) {
    try {
      const { error: removeError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(documentPaths);
      if (removeError) return filesFailed();
    } catch {
      return filesFailed();
    }
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
