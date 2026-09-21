import type { TFunction } from 'i18next';
import type { PriceEstimate, PriceEvidence } from './priceEvidence';

export function formatPriceEvidence(evidence: PriceEvidence, t: TFunction, locale: string): string {
  if (evidence.source === 'unavailable') return t('food.priceEvidence.unavailable');
  const price = new Intl.NumberFormat(locale, { style: 'currency', currency: 'DKK' }).format(evidence.price);
  const base = t('food.priceEvidence.detail', { price, store: evidence.store, source: t(`food.priceEvidence.${evidence.source}`), freshness: t(`food.priceEvidence.${evidence.freshness}`) });
  // Date-only campaign values are literal calendar dates, not device-local instants.
  return evidence.source === 'offer' ? `${base} · ${t('food.priceEvidence.validity', { from: evidence.validFrom, to: evidence.validTo })}` : base;
}
export function formatPriceEstimate(estimate: PriceEstimate, t: TFunction, locale: string): string {
  const amount = estimate.knownSubtotal === null ? '' : new Intl.NumberFormat(locale, { style: 'currency', currency: 'DKK' }).format(estimate.knownSubtotal);
  const parts = [t(`food.priceEvidence.estimate_${estimate.status}`, { amount })];
  for (const kind of ['unknown', 'stale', 'upcoming', 'missing'] as const) {
    if (estimate[kind]) parts.push(t(`food.priceEvidence.count_${kind}`, { count: estimate[kind] }));
  }
  return parts.join(' · ');
}
