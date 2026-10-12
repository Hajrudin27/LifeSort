import { Platform } from 'react-native';

/**
 * APP-070 — the iOS contact-name adapter (features/gifts/contacts/pickContactName.ts).
 *
 * The legacy bridge returns a whole contact. The adapter must reduce it to a name built from
 * `firstName` and `lastName` only, and nothing else may leave it. The mock exposes every other
 * contacts API too, so a call to any of them is caught.
 */
let mockLoads = 0;
const mockPresent = jest.fn();
const mockForbidden = {
  requestPermissionsAsync: jest.fn(),
  getPermissionsAsync: jest.fn(),
  getContactsAsync: jest.fn(),
  getContactByIdAsync: jest.fn(),
  addContactAsync: jest.fn(),
  updateContactAsync: jest.fn(),
  removeContactAsync: jest.fn(),
  getGroupsAsync: jest.fn(),
  getContainersAsync: jest.fn(),
  presentAccessPickerAsync: jest.fn(),
};
const legacyMock = () => {
  mockLoads += 1;
  return { presentContactPickerAsync: (...args: unknown[]) => mockPresent(...args), ...mockForbidden };
};

type Adapter = typeof import('@/features/gifts/contacts/pickContactName');
let adapter: Adapter;
const setPlatform = (os: string) => jest.replaceProperty(Platform, 'OS', os as typeof Platform.OS);

beforeEach(() => {
  jest.resetModules();
  jest.doMock('expo-contacts/legacy', legacyMock);
  mockLoads = 0;
  mockPresent.mockReset();
  Object.values(mockForbidden).forEach((fn) => fn.mockReset());
  jest.restoreAllMocks();
  setPlatform('ios');
  adapter = require('@/features/gifts/contacts/pickContactName');
});
afterEach(() => jest.restoreAllMocks());

const pick = (contact: unknown) => {
  mockPresent.mockResolvedValue(contact);
  return adapter.pickContactName();
};

describe('platform gate', () => {
  it.each(['android', 'web', 'windows', 'macos'])('%s: unavailable, and expo-contacts is never loaded or called', async (os) => {
    setPlatform(os);
    expect(adapter.isContactPickerSupported()).toBe(false);
    await expect(adapter.pickContactName()).resolves.toEqual({ ok: false, reason: 'unavailable' });
    expect(mockLoads).toBe(0);
    expect(mockPresent).not.toHaveBeenCalled();
  });

  it('ios: supported, and importing the adapter does not load expo-contacts', async () => {
    expect(adapter.isContactPickerSupported()).toBe(true);
    expect(mockLoads).toBe(0);
    mockPresent.mockResolvedValue(null);
    await adapter.pickContactName();
    expect(mockLoads).toBe(1);
  });
});

describe('outcomes', () => {
  it('a cancelled picker is "cancelled"', async () => {
    await expect(pick(null)).resolves.toEqual({ ok: false, reason: 'cancelled' });
    await expect(pick(undefined)).resolves.toEqual({ ok: false, reason: 'cancelled' });
  });

  it('a non-object answer is a safe error, not a name', async () => {
    await expect(pick('Alice')).resolves.toEqual({ ok: false, reason: 'error' });
    await expect(pick(42)).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('a rejection is a safe error, and the native message is never returned', async () => {
    mockPresent.mockRejectedValue(Object.assign(new Error('CNContact id 7F3A-SECRET failed'), { code: 'ERR_OTHER' }));
    const result = await adapter.pickContactName();
    expect(result).toEqual({ ok: false, reason: 'error' });
    expect(JSON.stringify(result)).not.toMatch(/SECRET|7F3A/);
  });

  it('the library\'s own unavailable code is "unavailable"', async () => {
    mockPresent.mockRejectedValue(Object.assign(new Error('x'), { code: 'ERR_UNAVAILABLE' }));
    await expect(adapter.pickContactName()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('a rejection that is not an Error is still a safe error', async () => {
    mockPresent.mockRejectedValue(null);
    await expect(adapter.pickContactName()).resolves.toEqual({ ok: false, reason: 'error' });
    mockPresent.mockRejectedValue('boom');
    await expect(adapter.pickContactName()).resolves.toEqual({ ok: false, reason: 'error' });
  });

  it('a binary without the native module fails inside the call, as "unavailable"', async () => {
    jest.resetModules();
    jest.doMock('expo-contacts/legacy', () => { throw new Error('Cannot find native module ExpoContacts'); });
    const fresh: Adapter = require('@/features/gifts/contacts/pickContactName');
    await expect(fresh.pickContactName()).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });
});

describe('name building: firstName and lastName only', () => {
  it.each([
    ['first + last', { firstName: 'Alice', lastName: 'Smith' }, 'Alice Smith'],
    ['first only', { firstName: 'Alice' }, 'Alice'],
    ['last only', { lastName: 'Smith' }, 'Smith'],
    ['whitespace around each part', { firstName: '  Alice ', lastName: '\tSmith\n' }, 'Alice Smith'],
    ['blank first, real last', { firstName: '   ', lastName: 'Smith' }, 'Smith'],
    ['real first, blank last', { firstName: 'Alice', lastName: '' }, 'Alice'],
    ['Unicode', { firstName: 'Søren', lastName: 'Ørsted-Åberg' }, 'Søren Ørsted-Åberg'],
    ['emoji and CJK', { firstName: '花子', lastName: '👩‍🔬' }, '花子 👩‍🔬'],
    ['internal spacing is kept', { firstName: 'Mary  Ann', lastName: 'Smith' }, 'Mary  Ann Smith'],
  ])('%s', async (_label, contact, expected) => {
    await expect(pick(contact)).resolves.toEqual({ ok: true, name: expected });
  });

  it('is not truncated, even far beyond the Gift limit: the form\'s normal validation decides on Save', async () => {
    const long = 'A'.repeat(300);
    await expect(pick({ firstName: long })).resolves.toEqual({ ok: true, name: long });
  });

  it.each([
    ['no name fields', {}],
    ['blank names', { firstName: ' ', lastName: '\n' }],
    ['non-string names', { firstName: 12, lastName: { value: 'x' } }],
    ['null names', { firstName: null, lastName: null }],
  ])('%s: no_name', async (_label, contact) => {
    await expect(pick(contact)).resolves.toEqual({ ok: false, reason: 'no_name' });
  });
});

describe('the rest of the contact is ignored and never leaves the adapter', () => {
  const SENTINEL = 'SENTINEL';
  const rich = {
    id: `${SENTINEL}-id`,
    lookupKey: `${SENTINEL}-key`,
    contactType: 'person',
    name: `${SENTINEL} Full Name`,
    middleName: `${SENTINEL}-middle`,
    namePrefix: `${SENTINEL}-prefix`,
    nameSuffix: `${SENTINEL}-suffix`,
    nickname: `${SENTINEL}-nick`,
    company: `${SENTINEL}-company`,
    jobTitle: `${SENTINEL}-job`,
    department: `${SENTINEL}-dept`,
    phoneNumbers: [{ number: `${SENTINEL}-555`, label: 'mobile' }],
    emails: [{ email: `${SENTINEL}@example.com` }],
    addresses: [{ street: `${SENTINEL} street` }],
    birthday: { day: 1, month: 1, year: 1990 },
    note: `${SENTINEL}-note`,
    image: { uri: `file://${SENTINEL}.png` },
    imageAvailable: true,
    relationships: [{ name: `${SENTINEL}-rel` }],
  };

  it('returns exactly { ok, name } and no other key or value', async () => {
    const result = await pick({ ...rich, firstName: 'Alice', lastName: 'Smith' });
    expect(result).toEqual({ ok: true, name: 'Alice Smith' });
    expect(Object.keys(result)).toEqual(['ok', 'name']);
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it.each([
    ['full name', 'name'], ['phone', 'phoneNumbers'], ['email', 'emails'], ['company', 'company'], ['birthday', 'birthday'],
    ['id', 'id'], ['nickname', 'nickname'], ['image', 'image'],
  ])('%s is never a fallback: with no first or last name the answer is no_name', async (_label, key) => {
    const result = await pick({ ...rich, firstName: undefined, lastName: undefined, [key]: rich[key as keyof typeof rich] });
    expect(result).toEqual({ ok: false, reason: 'no_name' });
    expect(JSON.stringify(result)).not.toContain(SENTINEL);
  });

  it('never reads a field other than firstName and lastName', async () => {
    const reads: string[] = [];
    const spyOn = (target: Record<string, unknown>) => new Proxy(target, {
      get(object, key) { if (typeof key === 'string') reads.push(key); return object[key as string]; },
      ownKeys(object) { reads.push('<ownKeys>'); return Reflect.ownKeys(object); },
      has(object, key) { reads.push(`<has:${String(key)}>`); return key in object; },
    });
    await pick(spyOn({ ...rich, firstName: 'Alice', lastName: 'Smith' }));
    // `then` is the mocked promise machinery resolving with the proxy, not the adapter.
    expect([...new Set(reads)].filter((key) => key !== 'then').sort()).toEqual(['firstName', 'lastName']);
  });
});

describe('only the single-contact picker is ever called', () => {
  it.each([
    ['a name', { firstName: 'Alice' }],
    ['a cancel', null],
    ['no name', {}],
  ])('%s: one picker call with no arguments; no permission, enumeration, lookup, write or group API', async (_label, contact) => {
    await pick(contact);
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockPresent).toHaveBeenCalledWith();
    for (const [name, fn] of Object.entries(mockForbidden)) expect({ name, calls: fn.mock.calls.length }).toEqual({ name, calls: 0 });
  });

  it('a rejection does not trigger a retry or a permission request', async () => {
    mockPresent.mockRejectedValue(new Error('x'));
    await adapter.pickContactName();
    expect(mockPresent).toHaveBeenCalledTimes(1);
    expect(mockForbidden.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('writes nothing to the console', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    await pick({ firstName: 'Sentinel', lastName: 'Person' });
    mockPresent.mockRejectedValue(new Error('Sentinel failure'));
    await adapter.pickContactName();
    expect(JSON.stringify(spies.flatMap((spy) => spy.mock.calls))).not.toMatch(/Sentinel/);
  });
});
