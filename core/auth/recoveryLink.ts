/**
 * Nulstillingslinket fra e-mailen (APP-019).
 *
 * Supabase sender brugeren tilbage til appen med tokens i URL'ens fragment.
 * Klienten er sat op med `detectSessionInUrl: false` — den indstilling giver
 * kun mening på web — så appen må selv læse linket.
 *
 * Alt herinde er rent og mistroisk: et link kan komme fra hvem som helst, der
 * kan åbne en URL på telefonen. Er der noget som helst galt, er svaret null —
 * aldrig et halvt resultat og aldrig en exception.
 */

export type RecoveryTokens = {
  accessToken: string;
  refreshToken: string;
};

function collectParams(source: string, into: Map<string, string>): void {
  for (const pair of source.split('&')) {
    const separatorIndex = pair.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);

    try {
      into.set(decodeURIComponent(key), decodeURIComponent(value));
    } catch {
      // Ugyldig procent-kodning: spring parret over frem for at kaste.
    }
  }
}

/**
 * Læser tokens ud af et gendannelseslink.
 *
 * Kræver udtrykkeligt `type=recovery`. Uden det tjek ville et hvilket som helst
 * link med tokens i kunne logge nogen ind på en fremmed konto — så havde vi
 * bygget en åben dør i stedet for en nulstilling.
 */
export function parseRecoveryLink(url: string): RecoveryTokens | null {
  if (typeof url !== 'string' || url.length === 0) return null;

  const params = new Map<string, string>();

  // Tokens ligger normalt i fragmentet efter '#'. Nogle klienter flytter dem
  // til query-strengen, så begge dele læses.
  const hashIndex = url.indexOf('#');
  if (hashIndex !== -1) collectParams(url.slice(hashIndex + 1), params);

  const queryIndex = url.indexOf('?');
  if (queryIndex !== -1) {
    const end = hashIndex > queryIndex ? hashIndex : url.length;
    collectParams(url.slice(queryIndex + 1, end), params);
  }

  if (params.get('type') !== 'recovery') return null;

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken) return null;

  return { accessToken, refreshToken };
}
