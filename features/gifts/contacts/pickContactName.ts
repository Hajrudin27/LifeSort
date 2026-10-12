import { Platform } from 'react-native';

/**
 * APP-070 — the one place LifeSort touches the device Contacts, and it can only do one thing: let the
 * user pick ONE person in the system's own picker and hand back a name string.
 *
 * Scope (ADR-0057):
 *  - iOS only. Android and web never load `expo-contacts`; Gifts stays manual-entry there.
 *  - No Contacts authorization is requested, read or cached. The legacy iOS picker is a system
 *    selection UI that returns the one chosen contact without standing permission.
 *  - No enumeration, no search, no writes. The only call is the single-contact picker.
 *
 * The legacy bridge hands back a whole contact object. It lives only inside this function. Of it,
 * exactly `firstName` and `lastName` are read; everything else is never inspected, copied, returned,
 * stored or logged. The result is a plain string or a fixed reason code, never a native error message,
 * because that text could carry an identifier.
 */
export type PickContactNameResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'cancelled' | 'unavailable' | 'no_name' | 'error' };

/** Where the picker is offered. The UI hides the button elsewhere; the adapter still fails closed. */
export function isContactPickerSupported(): boolean {
  return Platform.OS === 'ios';
}

type NameParts = { firstName?: unknown; lastName?: unknown };

/** `firstName` and `lastName` only: each trimmed, blanks dropped, joined with one space. */
function nameFrom({ firstName, lastName }: NameParts): string {
  return [firstName, lastName]
    .filter((part): part is string => typeof part === 'string')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .join(' ')
    .trim();
}

export async function pickContactName(): Promise<PickContactNameResult> {
  if (!isContactPickerSupported()) return { ok: false, reason: 'unavailable' };

  // Loaded here, not at import, so Gifts renders without the native module and an older dev-client
  // binary that lacks it fails inside this call instead of crashing the Gifts route.
  let present: () => Promise<unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const legacy: typeof import('expo-contacts/legacy') = require('expo-contacts/legacy');
    present = legacy.presentContactPickerAsync;
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  try {
    const picked = await present();
    if (picked === null || picked === undefined) return { ok: false, reason: 'cancelled' };
    if (typeof picked !== 'object') return { ok: false, reason: 'error' };
    const name = nameFrom(picked as NameParts);
    return name === '' ? { ok: false, reason: 'no_name' } : { ok: true, name };
  } catch (error) {
    // Only the library's own fixed code is compared; the message is never read.
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, reason: code === 'ERR_UNAVAILABLE' ? 'unavailable' : 'error' };
  }
}
