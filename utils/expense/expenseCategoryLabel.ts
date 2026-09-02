import { TFunction } from "i18next";

const BUILT_IN_IDS = ["subscription", "bill", "other"];

export function getCategoryLabel(categoryId: string, t: TFunction): string {
  if (BUILT_IN_IDS.includes(categoryId)) {
    return t(`expenses.categories.${categoryId}`);
  }
  return categoryId; // brugeroprettet kategori — vis navnet som det er
}
