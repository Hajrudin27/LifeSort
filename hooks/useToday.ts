import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { todayIso } from '@/utils/shared/localDate';

/**
 * The device-local calendar date, kept current: it is read again when the app returns to the
 * foreground and once more just after the next local midnight, so a screen left open overnight
 * does not keep treating yesterday as today. Every refresh arms the next timer, even when the
 * date turned out to be unchanged (a timer that fires early must not leave the screen stale).
 */
export function useToday(): string {
  const [state, setState] = useState(() => ({ today: todayIso(), tick: 0 }));

  useEffect(() => {
    const refresh = () => setState((previous) => ({ today: todayIso(), tick: previous.tick + 1 }));
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') refresh();
    });
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(refresh, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    return () => {
      subscription.remove();
      clearTimeout(timer);
    };
  }, [state.tick]);

  return state.today;
}
