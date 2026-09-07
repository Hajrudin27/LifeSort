import { useEnabledModulesStore } from '@/store/useEnabledModulesStore';

import { enabledModuleIds, isModuleEnabled } from './moduleEnablement';
import type { ModuleId } from './moduleRegistry';

/** Har brugeren valgt modulet til? Siger intet om, om det er udgivet. */
export function useModuleEnabled(moduleId: ModuleId): boolean {
  const enablement = useEnabledModulesStore((s) => s.enablement);
  return isModuleEnabled(moduleId, enablement);
}

/** Modulerne brugeren har valgt til. */
export function useEnabledModuleIds(): ModuleId[] {
  const enablement = useEnabledModulesStore((s) => s.enablement);
  return enabledModuleIds(enablement);
}
