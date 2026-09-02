import { TFunction } from 'i18next';

import { Skill } from '@/types/career';
import { EducationEntry, ExperienceEntry, LanguageEntry } from '@/types/cv';
import { getSkillCategoryLabel } from '@/utils/cv/skillCategoryLabel';

export interface CvSelectionIds {
  experienceIds: string[];
  educationIds: string[];
  languageIds: string[];
  skillIds: string[];
}

export function buildFilteredCvData(
  selection: CvSelectionIds,
  all: { experience: ExperienceEntry[]; education: EducationEntry[]; languages: LanguageEntry[]; skills: Skill[] },
  t: TFunction
) {
  const experience = all.experience.filter((e) => selection.experienceIds.includes(e.id));
  const education = all.education.filter((e) => selection.educationIds.includes(e.id));
  const languages = all.languages.filter((l) => selection.languageIds.includes(l.id));
  const selectedSkills = all.skills.filter((s) => selection.skillIds.includes(s.id));

  const usedCategories = Array.from(new Set(selectedSkills.map((s) => s.category)));
  const skillsByCategory = usedCategories.map((cat) => ({
    category: getSkillCategoryLabel(cat, t),
    skills: selectedSkills.filter((s) => s.category === cat).map((s) => ({ name: s.name, category: cat, level: s.level })),
  }));

  return { experience, education, languages, skillsByCategory };
}