/**
 * APP-045 test helper: make this process's Date local-time getters answer as a
 * device set to UTC would.
 *
 * `npm test` pins TZ=Europe/Copenhagen, so code that wrongly derives a budget
 * period from host-local time would still pass. Emulating a UTC host at an
 * instant where UTC and Copenhagen disagree makes that mistake visible. Only the
 * getters change; code under test that reads no local getter is unaffected.
 * Real host timezones are exercised in budgetPeriod.test.ts with a child process.
 */
const GETTERS = ['FullYear', 'Month', 'Date', 'Day', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'] as const;

export function emulateUtcHost(): () => void {
  const spies = [
    ...GETTERS.map((field) =>
      jest.spyOn(Date.prototype, `get${field}`).mockImplementation(function (this: Date) {
        return this[`getUTC${field}`]();
      }),
    ),
    jest.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0),
  ];
  return () => spies.forEach((spy) => spy.mockRestore());
}
