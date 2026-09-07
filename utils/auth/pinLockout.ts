import * as SecureStore from 'expo-secure-store';

const LOCKOUT_KEY = 'lifesort-pin-lockout';

const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** Antal fejl der tillades, før spærretiden begynder. */
export const FREE_ATTEMPTS = 4;

/**
 * Spærretid efter hver fejl ud over de frie forsøg. Sidste trin gentages, så en
 * angriber maksimalt kan afprøve to koder i timen — hele nøglerummet på 10.000
 * koder ville tage over et år.
 */
const BACKOFF_SCHEDULE_MS = [
  30_000,      // 5. fejl
  60_000,      // 6. fejl
  5 * 60_000,  // 7. fejl
  15 * 60_000, // 8. fejl
  30 * 60_000, // 9. fejl og derefter
];

type LockoutRecord = {
  failedAttempts: number;
  /** Hvornår spærretiden begyndte — bruges til at opdage at uret er stillet tilbage. */
  lockedAt: number;
  durationMs: number;
};

export type LockoutStatus = {
  locked: boolean;
  remainingMs: number;
  failedAttempts: number;
};

const UNLOCKED: LockoutStatus = { locked: false, remainingMs: 0, failedAttempts: 0 };

function backoffFor(failedAttempts: number): number {
  if (failedAttempts <= FREE_ATTEMPTS) return 0;
  const step = failedAttempts - FREE_ATTEMPTS - 1;
  return BACKOFF_SCHEDULE_MS[Math.min(step, BACKOFF_SCHEDULE_MS.length - 1)];
}

async function readRecord(): Promise<LockoutRecord | null> {
  try {
    const raw = await SecureStore.getItemAsync(LOCKOUT_KEY, SECURE_STORE_OPTIONS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.failedAttempts === 'number' &&
      typeof parsed.lockedAt === 'number' &&
      typeof parsed.durationMs === 'number'
    ) {
      return parsed as LockoutRecord;
    }
  } catch {
    // Ulæselig værdi behandles som "ingen spærring" — den skrives om ved næste fejl.
  }
  return null;
}

async function writeRecord(record: LockoutRecord): Promise<void> {
  await SecureStore.setItemAsync(LOCKOUT_KEY, JSON.stringify(record), SECURE_STORE_OPTIONS);
}

function statusFrom(record: LockoutRecord, now: number): LockoutStatus {
  const elapsed = now - record.lockedAt;

  // Uret er stillet tilbage siden spærringen begyndte. Vi kan ikke vide hvor meget,
  // så spærretiden startes forfra i stedet for at lade den udløbe gratis.
  if (elapsed < 0) {
    return { locked: record.durationMs > 0, remainingMs: record.durationMs, failedAttempts: record.failedAttempts };
  }

  const remainingMs = Math.max(0, record.durationMs - elapsed);
  return { locked: remainingMs > 0, remainingMs, failedAttempts: record.failedAttempts };
}

export async function getLockoutStatus(): Promise<LockoutStatus> {
  const record = await readRecord();
  if (!record) return UNLOCKED;

  const now = Date.now();
  const status = statusFrom(record, now);

  // Re-forankr spærringen, hvis uret er skruet tilbage, så nedtællingen er ægte.
  if (now < record.lockedAt) {
    await writeRecord({ ...record, lockedAt: now });
  }

  return status;
}

/**
 * Registrerer én fejlet indtastning og returnerer den spærring, det udløser.
 */
export async function registerFailedAttempt(): Promise<LockoutStatus> {
  const record = await readRecord();
  const failedAttempts = (record?.failedAttempts ?? 0) + 1;
  const durationMs = backoffFor(failedAttempts);
  const now = Date.now();

  await writeRecord({ failedAttempts, lockedAt: now, durationMs });

  return { locked: durationMs > 0, remainingMs: durationMs, failedAttempts };
}

/**
 * Nulstiller tælleren. Kaldes efter en gyldig PIN eller en godkendt biometrisk
 * oplåsning — begge dele beviser, at det er den rigtige bruger.
 */
export async function resetLockout(): Promise<void> {
  await SecureStore.deleteItemAsync(LOCKOUT_KEY, SECURE_STORE_OPTIONS);
}
