import type { MinorUnits } from '@/core/money/minorUnits';

/**
 * APP-069 — one gift idea for one person. The whole module is this flat entity: there is no
 * recipient, occasion or purchase entity, and "purchased" is not a status but the presence of
 * `purchasedOn`.
 *
 * Optional keys are omitted when absent: never null, never an empty string.
 */
export interface Gift {
  id: string;
  /** A label the user typed. Never a contact, never resolved against anything. */
  personLabel: string;
  idea: string;
  occasionLabel?: string;
  /** `YYYY-MM-DD`. Past or future; it ranks nothing and triggers nothing. */
  occasionDate?: string;
  /** The planned amount, DKK minor units. Not an expense. */
  budget?: MinorUnits;
  /** `YYYY-MM-DD`. Its presence is what "purchased" means. */
  purchasedOn?: string;
  /** What was actually paid, DKK minor units. Only ever present together with `purchasedOn`. */
  paid?: MinorUnits;
  createdAt: string;
}
