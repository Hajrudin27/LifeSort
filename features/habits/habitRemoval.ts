import { useHabitPreferencesStore } from '@/store/useHabitPreferencesStore';
import { onHabitRemoved } from '@/store/useHabitsStore';

/**
 * APP-065. A deleted habit takes its device-local streak choice with it. The two stores may not
 * import each other, so this module joins them; it is loaded with the logout registry
 * (features/localStores.ts), which the app root already imports.
 */
onHabitRemoved((habitId) => useHabitPreferencesStore.getState().removeHabitPreferences(habitId));
