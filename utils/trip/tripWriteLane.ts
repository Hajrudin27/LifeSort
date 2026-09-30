/**
 * Ordering for the remote writes of ONE trip (APP-058).
 *
 * The trip row is written fire-and-forget: create, then edit, edit, and finally
 * delete, each as its own request. Without an order a slow earlier upsert can commit
 * AFTER a confirmed delete and quietly put the trip back. This gives every trip one
 * lane: its remote mutations run one at a time, in the order they were asked for, and
 * a delete waits for everything asked before it.
 *
 * It is deliberately small. It is not a queue that survives a restart, it retries
 * nothing, and it is not the generic outbox (APP-031) — a lane lives in memory and
 * dies with the process, and a failed step never blocks the ones behind it.
 *
 * "Gone" is the other half: once a trip has been deleted (or removed from this
 * device because the server does not have it), any upsert still waiting in the lane
 * must not run, or it would recreate what the user just removed. The set holds ids of
 * one process's deleted trips; ids are random per trip, so nothing ever collides with it.
 */

const lanes = new Map<string, Promise<unknown>>();
const gone = new Set<string>();

/** Run `task` after every earlier task of this trip has settled. A rejection does not stop the lane. */
export function runInTripLane<T>(tripId: string, task: () => Promise<T>): Promise<T> {
  const previous = lanes.get(tripId) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(() => undefined, () => undefined);
  lanes.set(tripId, tail);
  void tail.then(() => {
    if (lanes.get(tripId) === tail) lanes.delete(tripId);
  });
  return run;
}

/** Resolves once every write asked for this trip so far has settled. Never rejects. */
export function settleTripWrites(tripId: string): Promise<void> {
  const tail = lanes.get(tripId);
  return tail ? tail.then(() => undefined) : Promise.resolve();
}

/** The trip is deleted or removed: queued upserts for it must not run. */
export function markTripGone(tripId: string): void {
  gone.add(tripId);
}

export function isTripGone(tripId: string): boolean {
  return gone.has(tripId);
}
