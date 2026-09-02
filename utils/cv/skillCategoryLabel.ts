import { TFunction } from 'i18next';

const BUILT_IN_IDS = ['technical', 'language', 'soft'];

export function getSkillCategoryLabel(categoryId: string, t: TFunction): string {
  if (BUILT_IN_IDS.includes(categoryId)) {
    return t(`career.category.${categoryId}`);
  }
  return categoryId;
}