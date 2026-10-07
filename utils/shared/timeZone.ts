/** Dependency-neutral IANA time-zone validation for storage and transport boundaries. */
export function isValidIanaTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: value });
    return typeof formatter.resolvedOptions().timeZone === 'string';
  } catch {
    return false;
  }
}

export function deviceIanaTimeZone(): string | null {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidIanaTimeZone(zone) ? zone : null;
}
