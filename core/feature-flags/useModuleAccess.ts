import {
  evaluateModuleAccess,
  type ModuleAccess,
  type ModuleViewer,
  PUBLIC_VIEWER,
} from '@/core/modules/moduleAvailability';
import type { ModuleId } from '@/core/modules/moduleRegistry';
import { useModuleFlagsStore } from '@/store/useModuleFlagsStore';

import { resolveModuleAvailability } from './moduleFlags';

/**
 * Hvad brugeren må i et modul lige nu — serverens kill switch lagt oven på
 * modulets erklærede tilstand. Ét opslag, så ingen skærm gætter selv.
 */
export function useModuleAccess(moduleId: ModuleId, viewer: ModuleViewer = PUBLIC_VIEWER): ModuleAccess {
  const overrides = useModuleFlagsStore((s) => s.overrides);
  return evaluateModuleAccess(resolveModuleAvailability(moduleId, overrides), viewer);
}
