/**
 * Samler flere hurtige ændringer (fx at krydse 5 gøremål af i træk) op i ét enkelt
 * batch-upsert i stedet for ét netværkskald pr. handling. Den seneste version af en
 * given række vinder, hvis den ændres flere gange, inden vinduet udløber.
 */
export function createSyncQueue<T extends { id: string }>(
    flush: (items: T[]) => Promise<void>,
    delayMs = 600,
  ) {
    const pending = new Map<string, T>();
    let timer: ReturnType<typeof setTimeout> | null = null;
  
    function scheduleFlush() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const items = Array.from(pending.values());
        pending.clear();
        timer = null;
        if (items.length > 0) {
          try {
            await flush(items);
          } catch {
            // Best-effort — lokal tilstand er allerede opdateret uanset.
          }
        }
      }, delayMs);
    }
  
    return {
      enqueue(item: T) {
        pending.set(item.id, item);
        scheduleFlush();
      },
    };
  }