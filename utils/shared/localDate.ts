/**
 * Kalenderdato-matematik ('YYYY-MM-DD') der hverken forskydes af tidszone
 * eller sommertid.
 *
 * To fælder gjorde det nødvendigt at samle det her:
 *
 * 1. `new Date(iso).toISOString().slice(0, 10)` går vejen om UTC. Lokal midnat
 *    i Danmark er kl. 22:00 eller 23:00 UTC dagen før, så rundturen giver en
 *    dato der ligger én dag for tidligt — hele året.
 *
 * 2. Millisekund-afstanden mellem to lokale midnatter er ikke altid et helt
 *    antal døgn. Hen over forårets omstilling er døgnet 23 timer, og
 *    `Math.floor(diff / 86400000)` taber derfor en dag.
 *
 * Regnestykkerne udføres i UTC, hvor et døgn altid er 86.400.000 ms, mens
 * "hvilken dag er det nu" altid læses af de lokale felter — det er brugerens
 * kalender, ikke Greenwich', der afgør hvad "i dag" betyder.
 */

const MS_PER_DAY = 86_400_000;

const pad = (value: number) => String(value).padStart(2, '0');

/** Tidspunktet for kalenderdatoens midnat i UTC — kun til regnestykker. */
function toUtcMidnight(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

/** 'YYYY-MM-DD' -> Date ved LOKAL midnat. Til visning og videre Date-brug. */
export function parseIsoDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/** Date -> 'YYYY-MM-DD' ud fra datoens LOKALE felter. */
export function toLocalIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Dagens dato i brugerens egen tidszone. */
export function todayIso(): string {
  return toLocalIsoDate(new Date());
}

/** Hele kalenderdage fra a til b. Negativ hvis b ligger før a. */
export function daysBetweenIso(a: string, b: string): number {
  return Math.round((toUtcMidnight(b) - toUtcMidnight(a)) / MS_PER_DAY);
}

/** Lægger et antal kalenderdage til en dato. Negativt tal trækker fra. */
export function addDaysIso(iso: string, days: number): string {
  const shifted = new Date(toUtcMidnight(iso) + days * MS_PER_DAY);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

/** Hele kalenderdage fra i dag til den givne dato. Negativ hvis den er passeret. */
export function daysUntilIso(iso: string): number {
  return daysBetweenIso(todayIso(), iso);
}
