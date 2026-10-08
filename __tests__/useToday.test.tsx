import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { AppState, Text } from 'react-native';

import { useToday } from '@/hooks/useToday';

function Probe() {
  return <Text>{useToday()}</Text>;
}

let tree: TestRenderer.ReactTestRenderer;
const shown = () => String(tree.root.findByType(Text).props.children);
const handlers: Array<(state: string) => void> = [];

beforeEach(() => {
  handlers.length = 0;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((_event: string, handler: (state: string) => void) => {
    handlers.push(handler);
    return { remove: jest.fn() };
  }) as never);
});
afterEach(() => { act(() => tree.unmount()); jest.useRealTimers(); jest.restoreAllMocks(); });

describe('useToday', () => {
  it('rolls over just after local midnight, without any other event', () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 8, 23, 59, 30) });
    act(() => { tree = TestRenderer.create(<Probe />); });
    expect(shown()).toBe('2026-10-08');
    act(() => { jest.advanceTimersByTime(20_000); });
    expect(shown()).toBe('2026-10-08');
    act(() => { jest.advanceTimersByTime(20_000); });
    expect(shown()).toBe('2026-10-09');
  });

  it('keeps rolling over on the following midnights', () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 8, 23, 59, 30) });
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => { jest.advanceTimersByTime(40_000); });
    expect(shown()).toBe('2026-10-09');
    act(() => { jest.advanceTimersByTime(24 * 60 * 60 * 1000); });
    expect(shown()).toBe('2026-10-10');
  });

  it('re-reads the date when the app returns to the foreground', () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 8, 12) });
    act(() => { tree = TestRenderer.create(<Probe />); });
    jest.setSystemTime(new Date(2026, 9, 11, 9));
    expect(shown()).toBe('2026-10-08');
    act(() => handlers.forEach((handler) => handler('background')));
    expect(shown()).toBe('2026-10-08');
    act(() => handlers.forEach((handler) => handler('active')));
    expect(shown()).toBe('2026-10-11');
  });

  it('uses the local date, not the UTC date, just after local midnight', () => {
    jest.useFakeTimers({ now: new Date(2026, 6, 1, 0, 30) }); // 22:30 on 30 June in UTC
    act(() => { tree = TestRenderer.create(<Probe />); });
    expect(shown()).toBe('2026-07-01');
  });

  it('arms exactly one timer and one foreground listener, re-arms exactly one after each rollover, and cleans up on unmount', () => {
    const remove = jest.fn();
    (AppState.addEventListener as jest.Mock).mockImplementation((_event: string, handler: (state: string) => void) => {
      handlers.push(handler);
      return { remove };
    });
    jest.useFakeTimers({ now: new Date(2026, 9, 8, 23, 59, 30) });
    act(() => { tree = TestRenderer.create(<Probe />); });
    expect(jest.getTimerCount()).toBe(1);
    expect(handlers).toHaveLength(1);
    act(() => { jest.advanceTimersByTime(40_000); });
    expect(shown()).toBe('2026-10-09');
    expect(jest.getTimerCount()).toBe(1); // the next midnight, not a polling loop
    act(() => tree.unmount());
    expect(jest.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalled();
  });

  it('does not poll: a quiet day wakes the component once, at midnight', () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 8, 0, 0, 5) });
    let renders = 0;
    function Counting() { renders += 1; return <Text>{useToday()}</Text>; }
    act(() => { tree = TestRenderer.create(<Counting />); });
    const initial = renders;
    act(() => { jest.advanceTimersByTime(23 * 60 * 60 * 1000); });
    expect(renders).toBe(initial);
    act(() => { jest.advanceTimersByTime(60 * 60 * 1000); });
    expect(renders).toBe(initial + 1);
  });

  // The project's tests run in Europe/Copenhagen (package.json), where the clocks change on 29 March and 25 October 2026.
  const copenhagen = new Date(2026, 9, 24, 12).getTimezoneOffset() === -120 && new Date(2026, 9, 25, 12).getTimezoneOffset() === -60;
  (copenhagen ? it : it.skip)('rolls over correctly across a 25-hour day (clocks go back) and a 23-hour day (clocks go forward)', () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 24, 23, 59, 30) });
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => { jest.advanceTimersByTime(40_000); });
    expect(shown()).toBe('2026-10-25');
    act(() => { jest.advanceTimersByTime(24 * 60 * 60 * 1000); }); // 24h later it is still the 25th: the day has 25 hours
    expect(shown()).toBe('2026-10-25');
    act(() => { jest.advanceTimersByTime(60 * 60 * 1000); });
    expect(shown()).toBe('2026-10-26');
    act(() => tree.unmount());

    jest.setSystemTime(new Date(2026, 2, 28, 23, 59, 30));
    act(() => { tree = TestRenderer.create(<Probe />); });
    act(() => { jest.advanceTimersByTime(40_000); });
    expect(shown()).toBe('2026-03-29');
    act(() => { jest.advanceTimersByTime(23 * 60 * 60 * 1000); }); // the 29th has only 23 hours
    expect(shown()).toBe('2026-03-30');
  });
});
