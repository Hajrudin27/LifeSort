export interface CVPersonalInfo {
    fullName: string;
    jobTitle?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
    summary?: string;
  }
  
  export interface EducationEntry {
    id: string;
    school: string;
    degree: string;
    fieldOfStudy?: string;
    startDate: string;
    endDate?: string; // undefined = i gang
    description?: string;
  }
  
  export interface ExperienceEntry {
    id: string;
    company: string;
    position: string;
    startDate: string;
    endDate?: string;
    description?: string;
  }
  
  export type LanguageProficiency = 'basic' | 'conversational' | 'fluent' | 'native';
  
  export interface LanguageEntry {
    id: string;
    name: string;
    proficiency: LanguageProficiency;
  }

  export type CvTheme = 'terracotta' | 'navy' | 'forest';

export interface CvVersion {
  id: string;
  name: string;
  theme: CvTheme;
  experienceIds: string[];
  educationIds: string[];
  languageIds: string[];
  skillIds: string[];
  createdAt: string;
}