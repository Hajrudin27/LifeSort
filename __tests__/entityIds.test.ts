import { randomUUID } from 'expo-crypto';
import { newEntityId } from '@/core/ids';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('APP-030 cryptographic entity IDs', () => {
  afterEach(() => jest.restoreAllMocks());

  it('uses the Expo CSPRNG boundary and returns distinct UUID v4 strings', () => {
    // The shared test-only Expo mock delegates to Node crypto.randomUUID.
    const crypto = randomUUID as jest.MockedFunction<typeof randomUUID>;
    crypto.mockClear();
    const ids = Array.from({ length: 1000 }, () => newEntityId());
    expect(crypto).toHaveBeenCalledTimes(ids.length);
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not read the device clock or use Math.random', () => {
    const clock = jest.spyOn(Date, 'now').mockImplementation(() => { throw new Error('clock read'); });
    const weakRandom = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('weak random'); });
    const ids = Array.from({ length: 20 }, () => newEntityId());
    expect(ids.every((id) => UUID_V4.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(clock).not.toHaveBeenCalled();
    expect(weakRandom).not.toHaveBeenCalled();
  });

  it('propagates crypto failure without a fallback', () => {
    const failure = new Error('secure UUID generation unavailable');
    (randomUUID as jest.MockedFunction<typeof randomUUID>).mockImplementationOnce(() => { throw failure; });
    expect(() => newEntityId()).toThrow(failure);
  });
});
