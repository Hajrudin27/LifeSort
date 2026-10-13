import { resolveModuleAvailability, type ModuleFlagOverrides } from '@/core/feature-flags/moduleFlags';
import { evaluateModuleAccess } from '@/core/modules/moduleAvailability';

/** Creation only: it never hides, deletes, or limits rights over existing data. */
export function canStartNewPregnancy(overrides: ModuleFlagOverrides = {}): boolean {
  return evaluateModuleAccess(resolveModuleAvailability('pregnancy', overrides)).canCreate;
}
