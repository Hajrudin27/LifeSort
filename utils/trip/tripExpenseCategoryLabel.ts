import { TripExpenseCategory } from "@/types/trip";
import { TFunction } from "i18next";

export function getTripCategoryLabel(
  category: TripExpenseCategory,
  t: TFunction,
): string {
  return t(`travel.categories.${category}`);
}
