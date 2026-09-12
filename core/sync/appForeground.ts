import { AppState, type AppStateStatus } from 'react-native';

/**
 * APP-037 — foreground is a precondition for automatic network work.
 *
 * LifeSort schedules no OS background execution: no background fetch, no task
 * scheduler, no headless JS, no silent push. Work happens while the user has
 * the app open, which is also when a phone is charging attention rather than
 * battery in the dark.
 */
export interface ForegroundSource {
  isForeground(): boolean;
  /** Called only on an actual change. Unsubscribing the last listener detaches. */
  subscribe(listener: (foreground: boolean) => void): () => void;
}

/** Only `active` counts. iOS `inactive` covers the app switcher and call banners. */
export function isForegroundState(state: AppStateStatus | null | undefined): boolean {
  return state === 'active';
}

export function createAppStateForeground(): ForegroundSource {
  let current = isForegroundState(AppState.currentState);
  let subscription: { remove(): void } | null = null;
  const listeners = new Set<(foreground: boolean) => void>();

  function attach() {
    if (subscription) return;
    subscription = AppState.addEventListener('change', (next: AppStateStatus) => {
      const foreground = isForegroundState(next);
      if (foreground === current) return;
      current = foreground;
      for (const listener of [...listeners]) {
        try {
          listener(foreground);
        } catch {
          // One observer must not break the others or the native subscription.
        }
      }
    });
  }

  return {
    isForeground: () => current,
    subscribe(listener) {
      listeners.add(listener);
      attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !subscription) return;
        subscription.remove();
        subscription = null;
        current = isForegroundState(AppState.currentState);
      };
    },
  };
}
