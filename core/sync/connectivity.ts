import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';

/**
 * APP-037 — normalized connectivity.
 *
 * Three states, because two would be a lie: a device that has not reported yet
 * is not the same as a device that reported no connection. Cellular counts as
 * online; LifeSort has no Wi-Fi-only rule and no large-upload policy here.
 */
export type ConnectivityState = 'online' | 'offline' | 'unknown';

export interface ConnectivitySource {
  getState(): ConnectivityState;
  /** Called only on an actual change. Unsubscribing the last listener detaches. */
  subscribe(listener: (state: ConnectivityState) => void): () => void;
}

/**
 * The OS link state is the only signal read here. `isInternetReachable` is
 * deliberately ignored: with probing disabled (see below) the library forces it
 * to false on platforms that have no native answer, so it would report a
 * perfectly good connection as offline. A link that is up but leads nowhere
 * produces a transient send failure, which is exactly what backoff is for.
 */
export function normalizeConnectivity(
  state: Pick<NetInfoState, 'isConnected' | 'type'> | null | undefined,
): ConnectivityState {
  if (!state) return 'unknown';
  if (state.isConnected === false || state.type === 'none') return 'offline';
  return state.isConnected === true ? 'online' : 'unknown';
}

let configured = false;

/**
 * Left alone, NetInfo repeatedly fetches https://clients3.google.com/generate_204
 * — every 60 seconds while connected, every 5 while not — on any platform whose
 * native layer does not answer the reachability question itself. That is both the
 * battery and data waste this story exists to remove, and a network destination
 * LifeSort's SDK and privacy inventory does not declare. The OS pushes us the
 * link state for free; that is all we ask for.
 */
function configureOnce(): void {
  if (configured) return;
  configured = true;
  NetInfo.configure({ reachabilityShouldRun: () => false });
}

export function createNetInfoConnectivity(): ConnectivitySource {
  configureOnce();
  let current: ConnectivityState = 'unknown';
  let detach: (() => void) | null = null;
  const listeners = new Set<(state: ConnectivityState) => void>();

  function attach() {
    if (detach) return;
    // NetInfo pushes the current state shortly after subscribing; no fetch loop.
    detach = NetInfo.addEventListener((state) => {
      const next = normalizeConnectivity(state);
      if (next === current) return;
      current = next;
      for (const listener of [...listeners]) {
        try {
          listener(next);
        } catch {
          // One observer must not break the others or the native subscription.
        }
      }
    });
  }

  return {
    getState: () => current,
    subscribe(listener) {
      listeners.add(listener);
      attach();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0 || !detach) return;
        detach();
        detach = null;
        // Nothing is observing, so nothing is known. Fail back to unknown.
        current = 'unknown';
      };
    },
  };
}
