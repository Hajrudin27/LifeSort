import type { FoodBudgetFacts } from '@/features/food/budgetReadModel';
import type { PriceEstimate } from '@/utils/food/priceEvidence';

/** Compare today's price evidence with what remains after this week's purchases.
 * A comparison is informational: APP-048 prices do not prove quantity coverage.
 */
export type FoodPlanBudgetAssessment =
  | { readonly status: 'no_budget' }
  | { readonly status: 'already_over'; readonly remaining: number }
  | { readonly status: 'price_unavailable'; readonly remaining: number }
  | {
      readonly status: 'current_within' | 'current_above' | 'partial_within' | 'partial_above';
      readonly remaining: number;
      readonly knownSubtotal: number;
    };

export function assessFoodPlanBudget(facts: FoodBudgetFacts, estimate: PriceEstimate): FoodPlanBudgetAssessment {
  if (!facts.hasBudget) return { status: 'no_budget' };
  if (facts.remaining < 0) return { status: 'already_over', remaining: facts.remaining };
  if (estimate.knownSubtotal === null) return { status: 'price_unavailable', remaining: facts.remaining };

  const evidence = estimate.status === 'current' ? 'current' : 'partial';
  const comparison = estimate.knownSubtotal > facts.remaining ? 'above' : 'within';
  return {
    status: `${evidence}_${comparison}`,
    remaining: facts.remaining,
    knownSubtotal: estimate.knownSubtotal,
  };
}
