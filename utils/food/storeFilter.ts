export function filterByStores<T extends { store: string }>(entries: T[], selectedStores: string[]): T[] {
    if (selectedStores.length === 0) return entries; // ingen valgt = vis alt
    const allowed = new Set(selectedStores.map((s) => s.toLowerCase()));
    return entries.filter((e) => allowed.has(e.store.toLowerCase()));
  }