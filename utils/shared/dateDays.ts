export function daysUntil(dateStr: string): number {
  const diffMs = new Date(dateStr).getTime() - new Date().setHours(0, 0, 0, 0);
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}
