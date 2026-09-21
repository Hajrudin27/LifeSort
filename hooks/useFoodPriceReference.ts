import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** Refresh visible campaign evidence on resume and while a screen stays open. */
export function useFoodPriceReference(): Date {
  const [reference, setReference] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => setReference(new Date());
    const timer = setInterval(refresh, 30_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  return reference;
}
