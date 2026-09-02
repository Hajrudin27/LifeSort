import { CvTheme } from '@/types/cv';

export interface CvThemeColors {
  primary: string;
  sidebarBg: string;
  skillBorder: string;
}

export const CV_THEMES: Record<CvTheme, CvThemeColors> = {
  terracotta: { primary: '#B5654A', sidebarBg: '#F3E9DF', skillBorder: '#E0997C' },
  navy: { primary: '#2C4A6E', sidebarBg: '#E7EDF3', skillBorder: '#5C7FA3' },
  forest: { primary: '#3F6B4F', sidebarBg: '#E8EFE8', skillBorder: '#6E9B7C' },
};

export const CV_THEME_LIST: CvTheme[] = ['terracotta', 'navy', 'forest'];