/**
 * Venter på at en persisteret store er læst fra disk (APP-014).
 *
 * Uden det her beregner et Home-kort sit tal, før dataene er indlæst, og viser
 * "0 kr." som en kendsgerning til en bruger, der har tusinder stående. Det er
 * værre end en spinner: det ligner tabte data, og det er ikke til at se, at det
 * er forkert.
 *
 * Zustands persist-middleware kan selv fortælle, hvornår den er færdig; vi
 * behøver ikke tilføje et flag til hver eneste store.
 */

type HydratablePersist = {
  persist: {
    hasHydrated: () => boolean;
    onFinishHydration: (listener: () => void) => () => void;
  };
};

/** Resolver med det samme, hvis store'en allerede er læst ind. */
export function whenStoreHydrated(store: HydratablePersist): Promise<void> {
  if (store.persist.hasHydrated()) return Promise.resolve();

  return new Promise((resolve) => {
    const unsubscribe = store.persist.onFinishHydration(() => {
      unsubscribe();
      resolve();
    });
  });
}

export function whenStoresHydrated(stores: HydratablePersist[]): Promise<void> {
  return Promise.all(stores.map(whenStoreHydrated)).then(() => undefined);
}
