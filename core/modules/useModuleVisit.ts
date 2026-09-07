import { usePathname } from 'expo-router';
import { useEffect } from 'react';

import { useHomeLayoutStore } from '@/store/useHomeLayoutStore';

import { moduleForPath } from './moduleRoutes';

/**
 * Noterer hvornår brugeren sidst var inde i et modul (APP-012).
 *
 * Registreres centralt ud fra stien, ikke i det enkelte kort — ellers ville
 * "senest brugt" i virkeligheden betyde "senest trykket på fra Home", og
 * rækkefølgen ville forstærke sig selv. Et modul, man når fra et tab, en hub
 * eller en notifikation, tæller lige så meget.
 *
 * Skallen selv tælles ikke med: Home er ikke et modul, man vender tilbage til.
 */
export function useRecordModuleVisit() {
  const pathname = usePathname();
  const recordModuleOpened = useHomeLayoutStore((s) => s.recordModuleOpened);

  useEffect(() => {
    const moduleId = moduleForPath(pathname);
    if (moduleId === 'core-shell' || moduleId === 'account') return;
    recordModuleOpened(moduleId);
  }, [pathname, recordModuleOpened]);
}
