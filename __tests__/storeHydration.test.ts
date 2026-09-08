import { whenStoreHydrated, whenStoresHydrated } from '@/core/storage/storeHydration';

/**
 * APP-014 — et kort må ikke regne på en store, der ikke er læst ind endnu.
 *
 * Ellers står der "0 kr." hos en bruger med tusinder — og det ligner tabte
 * data, uden at noget viser, at tallet er forkert.
 */

function fakeStore(startHydrated: boolean) {
  const listeners = new Set<() => void>();
  let hydrated = startHydrated;
  return {
    persist: {
      hasHydrated: () => hydrated,
      onFinishHydration: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    finish: () => {
      hydrated = true;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

describe('whenStoreHydrated', () => {
  it('venter ikke, hvis store\'en allerede er læst ind', async () => {
    await expect(whenStoreHydrated(fakeStore(true))).resolves.toBeUndefined();
  });

  it('venter, indtil disken er færdig', async () => {
    const store = fakeStore(false);
    let resolved = false;
    const waiting = whenStoreHydrated(store).then(() => {
      resolved = true;
    });

    // Stadig i gang: kortet må ikke være regnet ud endnu.
    await Promise.resolve();
    expect(resolved).toBe(false);

    store.finish();
    await waiting;
    expect(resolved).toBe(true);
  });

  it('rydder op efter sig', async () => {
    // En lytter pr. opslag ville hobe sig op ved hver refresh.
    const store = fakeStore(false);
    const waiting = whenStoreHydrated(store);
    expect(store.listenerCount()).toBe(1);
    store.finish();
    await waiting;
    expect(store.listenerCount()).toBe(0);
  });
});

describe('whenStoresHydrated', () => {
  it('venter på den langsomste', async () => {
    const fast = fakeStore(true);
    const slow = fakeStore(false);
    let resolved = false;
    const waiting = whenStoresHydrated([fast, slow]).then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    slow.finish();
    await waiting;
    expect(resolved).toBe(true);
  });

  it('klarer en tom liste', async () => {
    await expect(whenStoresHydrated([])).resolves.toBeUndefined();
  });
});
