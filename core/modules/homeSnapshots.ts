import { useCallback, useEffect, useState } from 'react';

import { resolveModuleAvailability } from '@/core/feature-flags/moduleFlags';
import { useModuleFlagsStore } from '@/store/useModuleFlagsStore';

import { evaluateModuleAccess } from './moduleAvailability';
import { isModuleEnabled } from './moduleEnablement';
import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';
import { type HomeSnapshot, MODULE_IDS, type ModuleId } from './moduleRegistry';

/**
 * Home henter små, sikre kort fra modulerne (APP-011).
 *
 * Pointen er hvad der IKKE sker her: Home kender ikke en eneste domæne-store.
 * Den beder om et kort og får et typet kort — ikke en udgift, ikke en cyklus,
 * ikke en rejse. Se docs/home-snapshots.md.
 *
 * Kernen kender ikke modulerne selv (ADR-0003), så leverandørerne rækkes ind
 * udefra af skallen, som er stedet hvor tingene sættes sammen.
 */

export type HomeSnapshotProvider = () => Promise<HomeSnapshot | null>;
export type HomeSnapshotProviders = Partial<Record<ModuleId, HomeSnapshotProvider>>;

export type HomeSnapshotsResult = {
  snapshots: HomeSnapshot[];
  isLoading: boolean;
  reload: () => void;
};

export function useHomeSnapshots(providers: HomeSnapshotProviders): HomeSnapshotsResult {
  const enablement = useEnabledModulesStore((s) => s.enablement);
  const overrides = useModuleFlagsStore((s) => s.overrides);

  const [snapshots, setSnapshots] = useState<HomeSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  useEffect(() => {
    let cancelled = false;

    const collect = async () => {
      const wanted = MODULE_IDS.filter((moduleId) => {
        if (!providers[moduleId]) return false;
        // Brugerens fravalg skjuler kortet; en kill switch gør det samme. To
        // spørgsmål, ét svar her — se ADR-0010.
        if (!isModuleEnabled(moduleId, enablement)) return false;
        return evaluateModuleAccess(resolveModuleAvailability(moduleId, overrides)).showInNavigation;
      });

      const results = await Promise.all(
        wanted.map(async (moduleId) => {
          try {
            return await providers[moduleId]!();
          } catch {
            // Ét modul der fejler, må ikke tømme hele Home. Kortet udebliver,
            // resten står.
            return null;
          }
        }),
      );

      if (cancelled) return;
      setSnapshots(results.filter((snapshot): snapshot is HomeSnapshot => snapshot !== null));
      setIsLoading(false);
    };

    collect();
    return () => {
      cancelled = true;
    };
    // providers er en konstant modul-map; den indgår bevidst ikke, så en ny
    // objekt-identitet ved hver render ikke starter en uendelig løkke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enablement, overrides, reloadToken]);

  return { snapshots, isLoading, reload };
}
