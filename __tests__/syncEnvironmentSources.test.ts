import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { createAppStateForeground, isForegroundState } from '@/core/sync/appForeground';
import {
  type ConnectivityState,
  createNetInfoConnectivity,
  normalizeConnectivity,
} from '@/core/sync/connectivity';

/**
 * APP-037 — the two platform sources the coordinator reads.
 *
 * They exist as their own files so the orchestration can be tested without a
 * radio or a phone, and so the normalization rules are written down once.
 */

type NetInfoMock = typeof NetInfo & {
  __emit: (next: Record<string, unknown>) => void;
  __reset: () => void;
  __listenerCount: () => number;
};
const netInfo = NetInfo as NetInfoMock;

beforeEach(() => {
  netInfo.__reset();
  jest.clearAllMocks();
});

describe('connectivity', () => {
  it.each([
    ['no report at all', undefined, 'unknown'],
    ['a platform that does not know', { isConnected: null, type: 'unknown' }, 'unknown'],
    ['no connection', { isConnected: false, type: 'none' }, 'offline'],
    // The probe result is ignored entirely; see normalizeConnectivity.
    ['a link with no reachability answer', { isConnected: true, isInternetReachable: false, type: 'wifi' }, 'online'],
    ['wifi', { isConnected: true, isInternetReachable: true, type: 'wifi' }, 'online'],
    // Cellular is real connectivity. LifeSort has no wifi-only rule.
    ['cellular', { isConnected: true, isInternetReachable: null, type: 'cellular' }, 'online'],
    ['a vpn', { isConnected: true, isInternetReachable: null, type: 'vpn' }, 'online'],
  ])('normalizes %s', (_label, state, expected) => {
    expect(normalizeConnectivity(state as never)).toBe(expected as ConnectivityState);
  });

  it('reports changes only, and never probes the network itself', () => {
    const source = createNetInfoConnectivity();
    const seen: ConnectivityState[] = [];
    const unsubscribe = source.subscribe((state) => seen.push(state));

    netInfo.__emit({ isConnected: true, type: 'wifi' });
    netInfo.__emit({ isConnected: true, type: 'wifi' });
    netInfo.__emit({ isConnected: false, type: 'none' });
    netInfo.__emit({ isConnected: true, type: 'cellular' });

    expect(seen).toEqual(['online', 'offline', 'online']);
    expect(source.getState()).toBe('online');
    // Reachability polling is off: no repeated request, and no third-party host.
    const [configuration] = (netInfo.configure as jest.Mock).mock.calls[0];
    expect(configuration.reachabilityShouldRun()).toBe(false);
    expect(netInfo.fetch).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('detaches the native listener when the last observer goes away', () => {
    const source = createNetInfoConnectivity();
    const unsubscribe = source.subscribe(() => {});
    const second = source.subscribe(() => {});
    expect(netInfo.__listenerCount()).toBe(1);

    unsubscribe();
    expect(netInfo.__listenerCount()).toBe(1);
    second();
    expect(netInfo.__listenerCount()).toBe(0);
    expect(source.getState()).toBe('unknown');
  });

  it('keeps a failing observer from breaking the others', () => {
    const source = createNetInfoConnectivity();
    const seen: ConnectivityState[] = [];
    source.subscribe(() => { throw new Error('observer'); });
    source.subscribe((state) => seen.push(state));

    netInfo.__emit({ isConnected: false, type: 'none' });
    expect(seen).toEqual(['offline']);
  });
});

describe('foreground', () => {
  it.each([
    ['active', true],
    ['inactive', false],
    ['background', false],
    ['unknown', false],
    [undefined, false],
  ])('treats %s as foreground: %s', (state, expected) => {
    expect(isForegroundState(state as never)).toBe(expected);
  });

  it('reports only real transitions and detaches on the last unsubscribe', () => {
    const app = AppState as unknown as { currentState: string };
    const original = app.currentState;
    app.currentState = 'active';
    let handler: ((state: string) => void) | null = null;
    const remove = jest.fn();
    const subscribe = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(((_event: string, listener: (state: string) => void) => {
        handler = listener;
        return { remove } as never;
      }) as never);

    const source = createAppStateForeground();
    const seen: boolean[] = [];
    const unsubscribe = source.subscribe((foreground) => seen.push(foreground));
    expect(subscribe).toHaveBeenCalledTimes(1);

    handler!('background');
    handler!('inactive');
    handler!('active');
    expect(seen).toEqual([false, true]);
    expect(source.isForeground()).toBe(true);

    unsubscribe();
    expect(remove).toHaveBeenCalledTimes(1);
    subscribe.mockRestore();
    app.currentState = original;
  });
});
