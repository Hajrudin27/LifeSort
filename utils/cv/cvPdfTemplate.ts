import { CVPersonalInfo, EducationEntry, ExperienceEntry, LanguageEntry, LanguageProficiency } from '@/types/cv';
import { formatCvDateRange } from '@/utils/cv/cvDateFormat';
import { CvThemeColors } from '@/utils/cv/cvThemes';

function escapeHtml(text: string | undefined): string {
  if (!text) return '';
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const PROFICIENCY_ORDER: Record<LanguageProficiency, number> = {
  native: 4,
  fluent: 3,
  conversational: 2,
  basic: 1,
};

type SkillForCv = { name: string; category: string; level: string };

export function buildCvHtml(params: {
  personalInfo: CVPersonalInfo;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  languages: LanguageEntry[];
  skillsByCategory: { category: string; skills: SkillForCv[] }[];
  locale: string;
  theme: CvThemeColors;
  labels: {
    currentLabel: string;
    experienceTitle: string;
    educationTitle: string;
    skillsTitle: string;
    languagesTitle: string;
    proficiency: Record<LanguageProficiency, string>;
  };
}): string {
  const { personalInfo, education, experience, languages, skillsByCategory, locale, theme, labels } = params;

  const sortedExperience = [...experience].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const sortedEducation = [...education].sort((a, b) => b.startDate.localeCompare(a.startDate));
  const sortedLanguages = [...languages].sort((a, b) => PROFICIENCY_ORDER[b.proficiency] - PROFICIENCY_ORDER[a.proficiency]);

  const contactParts = [personalInfo.email, personalInfo.phone, personalInfo.location, personalInfo.linkedin, personalInfo.website]
    .filter(Boolean)
    .map(escapeHtml);

  const experienceHtml = sortedExperience
    .map(
      (e) => `
      <div class="entry">
        <div class="entry-header">
          <span class="entry-title">${escapeHtml(e.position)}</span>
          <span class="entry-dates">${formatCvDateRange(e.startDate, e.endDate, locale, labels.currentLabel)}</span>
        </div>
        <div class="entry-subtitle">${escapeHtml(e.company)}</div>
        ${e.description ? `<div class="entry-desc">${escapeHtml(e.description)}</div>` : ''}
      </div>`
    )
    .join('');

  const educationHtml = sortedEducation
    .map(
      (e) => `
      <div class="entry">
        <div class="entry-header">
          <span class="entry-title">${escapeHtml(e.degree)}${e.fieldOfStudy ? `, ${escapeHtml(e.fieldOfStudy)}` : ''}</span>
          <span class="entry-dates">${formatCvDateRange(e.startDate, e.endDate, locale, labels.currentLabel)}</span>
        </div>
        <div class="entry-subtitle">${escapeHtml(e.school)}</div>
        ${e.description ? `<div class="entry-desc">${escapeHtml(e.description)}</div>` : ''}
      </div>`
    )
    .join('');

  const skillsHtml = skillsByCategory
    .map(
      (group) => `
      <div class="sidebar-group">
        <div class="sidebar-group-title">${escapeHtml(group.category)}</div>
        ${group.skills.map((s) => `<div class="skill-chip">${escapeHtml(s.name)}</div>`).join('')}
      </div>`
    )
    .join('');

  const languagesHtml = sortedLanguages
    .map(
      (l) => `
      <div class="lang-row">
        <span class="lang-name">${escapeHtml(l.name)}</span>
        <span class="lang-level">${labels.proficiency[l.proficiency]}</span>
      </div>`
    )
    .join('');

  return `
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
    margin: 0;
    color: #3B2C24;
    font-size: 13px;
    line-height: 1.5;
  }
  .header {
    background: ${theme.primary};
    color: #FFFFFF;
    padding: 32px 40px;
  }
  .header .name { font-size: 28px; font-weight: 700; margin: 0; }
  .header .job-title { font-size: 15px; font-weight: 400; opacity: 0.92; margin-top: 2px; }
  .header .contact { font-size: 11px; margin-top: 14px; opacity: 0.9; }
  .header .contact span:not(:last-child)::after { content: " · "; }

  .layout { display: flex; }
  .main { flex: 2; padding: 28px 32px; }
  .sidebar { flex: 1; background: ${theme.sidebarBg}; padding: 28px 24px; min-height: 100%; }

  .section-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: ${theme.primary};
    border-bottom: 1.5px solid #E8DDD0;
    padding-bottom: 6px;
    margin-bottom: 14px;
    margin-top: 26px;
  }
  .section-title:first-child { margin-top: 0; }

  .summary { font-size: 12.5px; line-height: 1.6; margin-bottom: 4px; }

  .entry { margin-bottom: 16px; }
  .entry-header { display: flex; justify-content: space-between; align-items: baseline; }
  .entry-title { font-weight: 700; font-size: 13.5px; }
  .entry-dates { font-size: 10.5px; color: #8A7A6D; white-space: nowrap; margin-left: 8px; }
  .entry-subtitle { font-size: 12px; color: ${theme.primary}; font-weight: 600; margin-top: 1px; }
  .entry-desc { font-size: 11.5px; color: #6B5C51; margin-top: 4px; }

  .sidebar-group { margin-bottom: 18px; }
  .sidebar-group-title { font-size: 10.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #8A7A6D; margin-bottom: 8px; }
  .skill-chip {
    display: inline-block;
    background: #FFFFFF;
    border: 1px solid ${theme.skillBorder};
    border-radius: 12px;
    padding: 3px 10px;
    font-size: 10.5px;
    margin: 0 6px 6px 0;
  }

  .lang-row { display: flex; justify-content: space-between; font-size: 11.5px; margin-bottom: 6px; }
  .lang-name { font-weight: 600; }
  .lang-level { color: #8A7A6D; }
</style>
</head>
<body>
  <div class="header">
    <p class="name">${escapeHtml(personalInfo.fullName)}</p>
    ${personalInfo.jobTitle ? `<p class="job-title">${escapeHtml(personalInfo.jobTitle)}</p>` : ''}
    ${contactParts.length > 0 ? `<div class="contact">${contactParts.map((c) => `<span>${c}</span>`).join('')}</div>` : ''}
  </div>

  <div class="layout">
    <div class="main">
      ${personalInfo.summary ? `<div class="section-title">Profil</div><div class="summary">${escapeHtml(personalInfo.summary)}</div>` : ''}
      ${experienceHtml ? `<div class="section-title">${labels.experienceTitle}</div>${experienceHtml}` : ''}
      ${educationHtml ? `<div class="section-title">${labels.educationTitle}</div>${educationHtml}` : ''}
    </div>
    <div class="sidebar">
      ${skillsHtml ? `<div class="section-title">${labels.skillsTitle}</div>${skillsHtml}` : ''}
      ${languagesHtml ? `<div class="section-title">${labels.languagesTitle}</div>${languagesHtml}` : ''}
    </div>
  </div>
</body>
</html>`;
}