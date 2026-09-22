import type { ShoppingContribution, ShoppingRequirement } from '@/core/food/shopping';
import type { MealType, Recipe } from '@/types/food';

type OccupiedSlot = { day: number; mealType: MealType; recipe: Recipe | null };
const mealOrder: MealType[] = ['breakfast', 'lunch', 'dinner'];

/** A plan snapshot yields requirements; IDs and persistence belong to the explicit user action. */
export function deriveShoppingList(slots: readonly OccupiedSlot[]): ShoppingRequirement[] {
  const groups = new Map<string, ShoppingRequirement>();
  const ordered = [...slots].sort((a, b) => a.day - b.day || mealOrder.indexOf(a.mealType) - mealOrder.indexOf(b.mealType) ||
    (a.recipe?.id ?? '').localeCompare(b.recipe?.id ?? ''));
  for (const slot of ordered) {
    if (!slot.recipe) continue;
    slot.recipe.ingredients.forEach((ingredient, ingredientIndex) => {
      const source = { recipeId: slot.recipe!.id, day: slot.day, mealType: slot.mealType, ingredientIndex, ingredientName: ingredient.name };
      const key = ingredient.kind === 'family'
        ? JSON.stringify(['family', ingredient.familyId, ingredient.unit])
        : JSON.stringify([ingredient.kind, slot.recipe!.id, ingredientIndex]);
      const contribution: ShoppingContribution = ingredient.kind === 'legacy'
        ? { ...source, kind: 'legacy', amount: ingredient.amount }
        : ingredient.kind === 'family'
          ? { ...source, kind: 'family', familyId: ingredient.familyId, quantity: ingredient.quantity, unit: ingredient.unit }
          : { ...source, kind: 'unlinked', quantity: ingredient.quantity, unit: ingredient.unit };
      const existing = groups.get(key);
      if (existing) {
        existing.provenance.push(contribution);
        if (existing.amount.kind === 'structured' && ingredient.kind !== 'legacy') {
          existing.amount.quantity += ingredient.quantity;
          if (!Number.isFinite(existing.amount.quantity)) throw new Error('shopping_quantity_invalid');
        } else if (existing.amount.kind === 'legacy') existing.amount.repetitions += 1;
        return;
      }
      const identity = ingredient.kind === 'family'
        ? { kind: 'family' as const, familyId: ingredient.familyId, unit: ingredient.unit }
        : ingredient.kind === 'unlinked'
          ? { kind: 'unlinked' as const, recipeId: slot.recipe!.id, ingredientIndex, unit: ingredient.unit }
          : { kind: 'legacy' as const, recipeId: slot.recipe!.id, ingredientIndex };
      const amount = ingredient.kind === 'legacy'
        ? { kind: 'legacy' as const, text: ingredient.amount, repetitions: 1 }
        : { kind: 'structured' as const, quantity: ingredient.quantity, unit: ingredient.unit };
      groups.set(key, { label: ingredient.name, identity, amount, provenance: [contribution] });
    });
  }
  return [...groups.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([, requirement]) => requirement);
}
