import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { supabase } from '@/lib/supabase';
import { CVPersonalInfo, CvVersion, EducationEntry, ExperienceEntry, LanguageEntry, LanguageProficiency } from '@/types/cv';

function newId() {
  return `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
}

interface CVState {
  personalInfo: CVPersonalInfo;
  updatePersonalInfo: (updates: Partial<CVPersonalInfo>) => void;

  education: EducationEntry[];
  addEducation: (input: Omit<EducationEntry, 'id'>) => void;
  updateEducation: (id: string, updates: Partial<Omit<EducationEntry, 'id'>>) => void;
  removeEducation: (id: string) => void;

  experience: ExperienceEntry[];
  addExperience: (input: Omit<ExperienceEntry, 'id'>) => void;
  updateExperience: (id: string, updates: Partial<Omit<ExperienceEntry, 'id'>>) => void;
  removeExperience: (id: string) => void;

  languages: LanguageEntry[];
  addLanguage: (name: string, proficiency: LanguageProficiency) => void;
  updateLanguage: (id: string, updates: Partial<Pick<LanguageEntry, 'name' | 'proficiency'>>) => void;
  removeLanguage: (id: string) => void;

  versions: CvVersion[];
  addVersion: (input: Omit<CvVersion, 'id' | 'createdAt'>) => void;
  removeVersion: (id: string) => void;

  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

async function syncPersonalInfo(userId: string, info: CVPersonalInfo) {
  const { error } = await supabase.from('cv_personal_info').upsert({
    user_id: userId,
    full_name: info.fullName ?? '',
    job_title: info.jobTitle ?? null,
    email: info.email ?? null,
    phone: info.phone ?? null,
    location: info.location ?? null,
    linkedin: info.linkedin ?? null,
    website: info.website ?? null,
    summary: info.summary ?? null,
  });
  if (error) console.log('CV sync error (personalInfo):', error.message);
}

function educationToRow(userId: string, e: EducationEntry) {
  return {
    id: e.id,
    user_id: userId,
    school: e.school,
    degree: e.degree,
    field_of_study: e.fieldOfStudy ?? null,
    start_date: e.startDate,
    end_date: e.endDate ?? null,
    description: e.description ?? null,
  };
}

function experienceToRow(userId: string, e: ExperienceEntry) {
  return {
    id: e.id,
    user_id: userId,
    company: e.company,
    position: e.position,
    start_date: e.startDate,
    end_date: e.endDate ?? null,
    description: e.description ?? null,
  };
}

function languageToRow(userId: string, l: LanguageEntry) {
  return { id: l.id, user_id: userId, name: l.name, proficiency: l.proficiency };
}

function versionToRow(userId: string, v: CvVersion) {
  return {
    id: v.id,
    user_id: userId,
    name: v.name,
    theme: v.theme,
    experience_ids: v.experienceIds,
    education_ids: v.educationIds,
    language_ids: v.languageIds,
    skill_ids: v.skillIds,
    created_at: v.createdAt,
  };
}

export const useCVStore = create<CVState>()(
  persist(
    (set, get) => ({
      personalInfo: {} as CVPersonalInfo,
      updatePersonalInfo: (updates) => {
        set((state) => ({ personalInfo: { ...state.personalInfo, ...updates } }));
        getUserId().then((userId) => {
          if (userId) syncPersonalInfo(userId, get().personalInfo);
        });
      },

      education: [],
      addEducation: (input) => {
        const newEntry: EducationEntry = { id: newId(), ...input };
        set((state) => ({ education: [...state.education, newEntry] }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_education').upsert(educationToRow(userId, newEntry)).then(({ error }) => {
            if (error) console.log('CV sync error (addEducation):', error.message);
          });
        });
      },
      updateEducation: (id, updates) => {
        set((state) => ({ education: state.education.map((e) => (e.id === id ? { ...e, ...updates } : e)) }));
        const target = get().education.find((e) => e.id === id);
        if (target) {
          getUserId().then((userId) => {
            if (!userId) return;
            supabase.from('cv_education').upsert(educationToRow(userId, target)).then(({ error }) => {
              if (error) console.log('CV sync error (updateEducation):', error.message);
            });
          });
        }
      },
      removeEducation: (id) => {
        set((state) => ({ education: state.education.filter((e) => e.id !== id) }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_education').delete().eq('user_id', userId).eq('id', id).then(({ error }) => {
            if (error) console.log('CV sync error (removeEducation):', error.message);
          });
        });
      },

      experience: [],
      addExperience: (input) => {
        const newEntry: ExperienceEntry = { id: newId(), ...input };
        set((state) => ({ experience: [...state.experience, newEntry] }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_experience').upsert(experienceToRow(userId, newEntry)).then(({ error }) => {
            if (error) console.log('CV sync error (addExperience):', error.message);
          });
        });
      },
      updateExperience: (id, updates) => {
        set((state) => ({ experience: state.experience.map((e) => (e.id === id ? { ...e, ...updates } : e)) }));
        const target = get().experience.find((e) => e.id === id);
        if (target) {
          getUserId().then((userId) => {
            if (!userId) return;
            supabase.from('cv_experience').upsert(experienceToRow(userId, target)).then(({ error }) => {
              if (error) console.log('CV sync error (updateExperience):', error.message);
            });
          });
        }
      },
      removeExperience: (id) => {
        set((state) => ({ experience: state.experience.filter((e) => e.id !== id) }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_experience').delete().eq('user_id', userId).eq('id', id).then(({ error }) => {
            if (error) console.log('CV sync error (removeExperience):', error.message);
          });
        });
      },

      languages: [],
      addLanguage: (name, proficiency) => {
        const newEntry: LanguageEntry = { id: newId(), name, proficiency };
        set((state) => ({ languages: [...state.languages, newEntry] }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_languages').upsert(languageToRow(userId, newEntry)).then(({ error }) => {
            if (error) console.log('CV sync error (addLanguage):', error.message);
          });
        });
      },
      updateLanguage: (id, updates) => {
        set((state) => ({ languages: state.languages.map((l) => (l.id === id ? { ...l, ...updates } : l)) }));
        const target = get().languages.find((l) => l.id === id);
        if (target) {
          getUserId().then((userId) => {
            if (!userId) return;
            supabase.from('cv_languages').upsert(languageToRow(userId, target)).then(({ error }) => {
              if (error) console.log('CV sync error (updateLanguage):', error.message);
            });
          });
        }
      },
      removeLanguage: (id) => {
        set((state) => ({ languages: state.languages.filter((l) => l.id !== id) }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_languages').delete().eq('user_id', userId).eq('id', id).then(({ error }) => {
            if (error) console.log('CV sync error (removeLanguage):', error.message);
          });
        });
      },

      versions: [],
      addVersion: (input) => {
        const newVersion: CvVersion = { id: newId(), createdAt: new Date().toISOString(), ...input };
        set((state) => ({ versions: [...state.versions, newVersion] }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_versions').upsert(versionToRow(userId, newVersion)).then(({ error }) => {
            if (error) console.log('CV sync error (addVersion):', error.message);
          });
        });
      },
      removeVersion: (id) => {
        set((state) => ({ versions: state.versions.filter((v) => v.id !== id) }));
        getUserId().then((userId) => {
          if (!userId) return;
          supabase.from('cv_versions').delete().eq('user_id', userId).eq('id', id).then(({ error }) => {
            if (error) console.log('CV sync error (removeVersion):', error.message);
          });
        });
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [personalResult, eduResult, expResult, langResult, versionsResult] = await Promise.all([
          supabase.from('cv_personal_info').select('full_name, job_title, email, phone, location, linkedin, website, summary').eq('user_id', userId).single(),
          supabase.from('cv_education').select('id, school, degree, field_of_study, start_date, end_date, description').eq('user_id', userId),
          supabase.from('cv_experience').select('id, company, position, start_date, end_date, description').eq('user_id', userId),
          supabase.from('cv_languages').select('id, name, proficiency').eq('user_id', userId),
          supabase.from('cv_versions').select('id, name, theme, experience_ids, education_ids, language_ids, skill_ids, created_at').eq('user_id', userId),
        ]);

        set((state) => {
          const next: Partial<CVState> = {};

          if (!personalResult.error && personalResult.data && !state.personalInfo.fullName) {
            const row = personalResult.data;
            next.personalInfo = {
              fullName: row.full_name,
              jobTitle: row.job_title ?? undefined,
              email: row.email ?? undefined,
              phone: row.phone ?? undefined,
              location: row.location ?? undefined,
              linkedin: row.linkedin ?? undefined,
              website: row.website ?? undefined,
              summary: row.summary ?? undefined,
            };
          }

          if (!eduResult.error && eduResult.data) {
            const existingIds = new Set(state.education.map((e) => e.id));
            const fetched: EducationEntry[] = eduResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                school: row.school,
                degree: row.degree,
                fieldOfStudy: row.field_of_study ?? undefined,
                startDate: row.start_date,
                endDate: row.end_date ?? undefined,
                description: row.description ?? undefined,
              }));
            next.education = [...state.education, ...fetched];
          }

          if (!expResult.error && expResult.data) {
            const existingIds = new Set(state.experience.map((e) => e.id));
            const fetched: ExperienceEntry[] = expResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                company: row.company,
                position: row.position,
                startDate: row.start_date,
                endDate: row.end_date ?? undefined,
                description: row.description ?? undefined,
              }));
            next.experience = [...state.experience, ...fetched];
          }

          if (!langResult.error && langResult.data) {
            const existingIds = new Set(state.languages.map((l) => l.id));
            const fetched: LanguageEntry[] = langResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                name: row.name,
                proficiency: row.proficiency as LanguageProficiency,
              }));
            next.languages = [...state.languages, ...fetched];
          }

          if (!versionsResult.error && versionsResult.data) {
            const existingIds = new Set(state.versions.map((v) => v.id));
            const fetched: CvVersion[] = versionsResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                name: row.name,
                theme: row.theme as CvVersion['theme'],
                experienceIds: row.experience_ids ?? [],
                educationIds: row.education_ids ?? [],
                languageIds: row.language_ids ?? [],
                skillIds: row.skill_ids ?? [],
                createdAt: row.created_at,
              }));
            next.versions = [...state.versions, ...fetched];
          }

          return next;
        });
      },
    }),
    {
      name: 'lifesort-cv',
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);