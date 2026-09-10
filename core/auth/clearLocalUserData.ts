import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import {
  clearCycleHealthEncryptionKey,
  withCycleHealthEncryptedStorageCleanup,
} from '@/core/storage/cycleHealthEncryptedStorage';
import {
  clearDocumentCacheEncryptionKey,
  withDocumentCacheCleanup,
} from '@/core/storage/documentCacheStorage';
import { userDataKeys } from '@/core/storage/localDataScopes';
import { clearLocalPin } from '@/utils/auth/pinAuth';
import { clearAttachmentCache } from '@/utils/shared/attachmentStorage';
import { clearSignedUrlCache } from '@/utils/shared/attachmentSync';
import { clearAttachmentViewerSources } from '@/utils/shared/attachmentViewerSource';

import { clearResendThrottle } from './emailVerification';
import { clearVerification } from './reauth';

/**
 * Rydder alt lokalt, der hører til den bruger, som logger ud (APP-021).
 *
 * Kaldes både ved log ud og FØR et nyt login, så to konti aldrig kan blande
 * sig med hinanden på samme telefon.
 *
 * Fem ting skal væk, og de tre sidste blev glemt indtil nu:
 *   1. Det, der ligger i hukommelsen — ellers ser den næste bruger de gamle
 *      tal, indtil appen genstartes.
 *   2. Det, der ligger på disken — ellers kommer de tilbage ved genstart.
 *   3. Filerne. Kvitteringer og garantibilleder blev liggende (fund D4).
 *   4. De planlagte påmindelser. En cyklus-påmindelse kunne poppe op på en
 *      telefon, hvor kontoen var logget ud for en uge siden (fund D5).
 *   5. Nøglerne: PIN, signerede URL'er, spærretid på bekræftelsesmails og
 *      cykluslagerets krypteringsnøgle.
 *
 * Rækkefølgen betyder noget: hukommelsen først, så disken. Nulstiller man en
 * store, skriver dens persist-lag den tomme tilstand tilbage til disken — gør
 * man det efter fejningen, skriver man nøglerne frem igen.
 */

export type LocalStoreReset = {
  /** Persist-nøglen, så testen kan se, at hver store er dækket. */
  key: string;
  /** Nulstiller store'ens tilstand i hukommelsen. */
  reset: () => void;
};

export async function clearLocalUserData(resets: readonly LocalStoreReset[]): Promise<void> {
  // Drop sensitive navigation handoffs before waiting on any storage cleanup.
  clearAttachmentViewerSources();
  let pendingCleanupError: unknown;

  await withCycleHealthEncryptedStorageCleanup(async () => withDocumentCacheCleanup(async () => {
    try {
      // 1. Hukommelsen.
      for (const store of resets) {
        try {
          store.reset();
        } catch {
          // En enkelt store, der fejler, må ikke efterlade resten urørt.
        }
      }

      // 2. Disken. Fejningen er det, der gør oprydningen fuldstændig: den finder
      // også de stores, ingen har husket at melde ind — og dem, der aldrig blev
      // importeret i den her session og derfor ikke kunne nulstilles ovenfor.
      try {
        const allKeys = await AsyncStorage.getAllKeys();
        const toRemove = userDataKeys(allKeys);
        if (toRemove.length > 0) await AsyncStorage.multiRemove(toRemove);
      } catch {
        // Hukommelsen er allerede ryddet; en fejlende disk må ikke afbryde resten.
      }

      // 3. Filerne.
      await clearAttachmentCache();

      // 4. Påmindelserne. Alle er brugerens egne, så alle skal væk.
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
      } catch {
        // Ingen tilladelse, eller ingen planlagte. Ikke en grund til at stoppe.
      }

      // 5. Nøglerne.
      clearSignedUrlCache();
      clearVerification();
      await clearResendThrottle();
      await clearLocalPin();
    } catch (error) {
      pendingCleanupError = error;
    } finally {
      await clearDocumentCacheEncryptionKey();
      await clearCycleHealthEncryptionKey();
    }

    if (pendingCleanupError) throw pendingCleanupError;
  }));
}
