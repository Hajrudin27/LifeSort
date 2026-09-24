import type { ShoppingRequirement } from '@/core/food/shopping';
import type { GlobalOffer } from '@/types/food';
import { offerEvidence, validOfferEntry } from '@/utils/food/priceEvidence';

export type OfferOpportunity = {
  familyId: Extract<ShoppingRequirement['identity'], { kind: 'family' }>['familyId'];
  label: string;
  productName: string;
  store: string;
  offerPrice: number;
  referencePrice: number;
  potentialDifference: number;
  validFrom: string;
  validTo: string;
  memberCondition: string | null;
  automaticEligible: boolean;
  referenceFreshness: 'unknown';
};

/**
 * APP-053 projection only. It never persists, infers identity from labels,
 * multiplies by recipe quantities, or aggregates catalogue comparisons.
 */
export function deriveOfferOpportunities(
  requirements: readonly ShoppingRequirement[],
  offers: readonly GlobalOffer[],
  selectedStores: readonly string[],
  reference: Date,
): OfferOpportunity[] {
  type FamilyRequirement = ShoppingRequirement & { identity: Extract<ShoppingRequirement['identity'], { kind: 'family' }> };
  const familyRequirements = new Map<string, FamilyRequirement>();
  for (const requirement of requirements) {
    if (requirement.identity.kind === 'family' && !familyRequirements.has(requirement.identity.familyId)) {
      familyRequirements.set(requirement.identity.familyId, requirement as FamilyRequirement);
    }
  }

  const opportunities: OfferOpportunity[] = [];
  for (const [familyId, requirement] of familyRequirements) {
    const candidates = offers
      .filter((offer) => validOfferEntry(offer) && offer.ingredientFamilyId === familyId
        && selectedStores.includes(offer.store) && offerEvidence(offer, reference).freshness === 'current'
        && offer.referencePrice > offer.offerPrice)
      .sort((a, b) => Number(a.memberCondition !== null) - Number(b.memberCondition !== null)
        || a.offerPrice - b.offerPrice || a.store.localeCompare(b.store) || a.id.localeCompare(b.id));
    const offer = candidates[0];
    if (!offer) continue;
    opportunities.push({
      familyId: requirement.identity.familyId,
      label: requirement.label,
      productName: offer.productName,
      store: offer.store,
      offerPrice: offer.offerPrice,
      referencePrice: offer.referencePrice,
      potentialDifference: offer.referencePrice - offer.offerPrice,
      validFrom: offer.validFrom,
      validTo: offer.validTo,
      memberCondition: offer.memberCondition,
      automaticEligible: offer.memberCondition === null,
      referenceFreshness: 'unknown',
    });
  }
  return opportunities.sort((a, b) => a.label.localeCompare(b.label) || a.familyId.localeCompare(b.familyId));
}
