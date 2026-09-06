import { supabase } from '@/lib/supabase';
import { clearAllLocalData } from '@/utils/auth/clearAllLocalData';

const BUCKET = 'attachments';

export type DeleteAccountResult = { error: null } | { error: 'not_authenticated' | 'admin_account' | 'unknown' };

/**
 * Sletter brugerens konto og alt indhold.
 *
 * Rækkefølgen er ikke tilfældig. Filerne i storage skal fjernes FØR kontoen, for bagefter
 * har vi ikke længere en session der må røre dem: storage-policyen tillader kun en bruger
 * at slette sine egne filer, og "sine egne" er defineret ud fra en bruger der lige er
 * blevet slettet.
 *
 * Stierne læses fra attachments-tabellen frem for at liste bucket'en. Filerne ligger i
 * indlejrede mapper (bruger/type/ejer/fil), og tabellen ved præcis hvor de er.
 *
 * Skulle fil-oprydningen fejle halvvejs, fjerner den daglige oprydning på serveren
 * resterne: den finder filer hvis ejer ikke længere findes. Det er derfor sletningen er
 * en garanti og ikke bare et forsøg.
 */
export async function deleteAccount(): Promise<DeleteAccountResult> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { error: 'not_authenticated' };

  const { data: rows } = await supabase
    .from('attachments')
    .select('storage_path')
    .eq('user_id', userId);

  const paths = (rows ?? [])
    .map((row: { storage_path: string | null }) => row.storage_path)
    .filter((path): path is string => Boolean(path));

  if (paths.length > 0) {
    await supabase.storage.from(BUCKET).remove(paths);
  }

  // Selve sletningen. Alle bruger-tabeller har ON DELETE CASCADE fra auth.users, så det
  // her ene kald fjerner hele indholdet — uden en liste over tabeller der ville blive
  // forældet, næste gang der kommer en ny til.
  const { error } = await supabase.rpc('delete_my_account');

  if (error) {
    if (error.message.includes('admin_account')) return { error: 'admin_account' };
    if (error.message.includes('not_authenticated')) return { error: 'not_authenticated' };
    return { error: 'unknown' };
  }

  await supabase.auth.signOut();
  await clearAllLocalData();

  return { error: null };
}
