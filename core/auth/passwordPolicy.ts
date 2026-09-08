/**
 * Adgangskodekrav (APP-019).
 *
 * Ét krav: længde. Ingen krav om store bogstaver, tal eller tegn.
 *
 * Sammensætningsregler gør ikke kodeord stærkere — de gør dem forudsigelige.
 * "Sommer2026!" opfylder enhver klassisk regel og er blandt de første, en
 * angriber prøver, mens en lang passphrase fra en kodeordsmanager falder
 * igennem, hvis man kræver et tal. Reglerne straffer altså præcis den adfærd,
 * de burde belønne. Længden er det eneste, der faktisk koster en angriber noget.
 */

/**
 * Otte tegn. Supabase' egen standard er seks; vi lægger to oveni, fordi det er
 * gratis for en manager-genereret kode og mærkbart for en gættet.
 */
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordProblem = 'auth.passwordTooShort';

/**
 * Kun til NYE kodeord — oprettelse og nulstilling.
 *
 * Aldrig ved login. Et eksisterende kodeord er allerede accepteret; at måle det
 * mod dagens regel ville låse brugeren ude af sin egen konto på grund af en
 * regel, vi selv har ændret bagefter — og samtidig fortælle en fremmed, hvad
 * reglen er.
 */
export function newPasswordProblem(password: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'auth.passwordTooShort';
  return null;
}
