import { newEntityId } from '@/core/ids';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from "@/lib/supabase";
import {
  ApplicationStatus,
  JobApplication,
  Skill,
  SkillCategory,
  SkillLevel,
} from "@/types/career";

type ApplicationEditableFields = Pick<JobApplication, "company" | "position" | "status" | "appliedDate" | "link" | "notes">;
type SkillEditableFields = Pick<Skill, "name" | "category" | "level">;

interface CareerState {
  applications: JobApplication[];
  addApplication: (input: {
    company: string;
    position: string;
    status: ApplicationStatus;
    appliedDate: string;
    link?: string;
    notes?: string;
  }) => void;
  updateApplication: (id: string, updates: Partial<ApplicationEditableFields>) => void;
  removeApplication: (id: string) => void;
  skills: Skill[];
  addSkill: (input: {
    name: string;
    category: SkillCategory;
    level: SkillLevel;
  }) => void;
  updateSkill: (id: string, updates: Partial<SkillEditableFields>) => void;
  removeSkill: (id: string) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function applicationToRow(userId: string, a: JobApplication) {
  return {
    id: a.id,
    user_id: userId,
    company: a.company,
    position: a.position,
    status: a.status,
    applied_date: a.appliedDate,
    link: a.link ?? null,
    notes: a.notes ?? null,
    created_at: a.createdAt,
  };
}

function skillToRow(userId: string, sk: Skill) {
  return {
    id: sk.id,
    user_id: userId,
    name: sk.name,
    category: sk.category,
    level: sk.level,
    created_at: sk.createdAt,
  };
}

async function syncUpsertApplication(app: JobApplication) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('job_applications').upsert(applicationToRow(userId, app));
}
async function syncDeleteApplication(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('job_applications').delete().eq('user_id', userId).eq('id', id);
}

async function syncUpsertSkill(skill: Skill) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('skills').upsert(skillToRow(userId, skill));
}
async function syncDeleteSkill(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('skills').delete().eq('user_id', userId).eq('id', id);
}

export const useCareerStore = create<CareerState>()(
  persist(
    (set, get) => ({
      applications: [],
      addApplication: (input) => {
        const newApp: JobApplication = { id: newEntityId(), createdAt: new Date().toISOString(), ...input };
        set((state) => ({ applications: [...state.applications, newApp] }));
        syncUpsertApplication(newApp);
      },
      updateApplication: (id, updates) => {
        set((state) => ({
          applications: state.applications.map((a) => (a.id === id ? { ...a, ...updates } : a)),
        }));
        const target = get().applications.find((a) => a.id === id);
        if (target) syncUpsertApplication(target);
      },
      removeApplication: (id) => {
        set((state) => ({
          applications: state.applications.filter((a) => a.id !== id),
        }));
        syncDeleteApplication(id);
      },

      skills: [],
      addSkill: (input) => {
        const newSkill: Skill = { id: newEntityId(), createdAt: new Date().toISOString(), ...input };
        set((state) => ({ skills: [...state.skills, newSkill] }));
        syncUpsertSkill(newSkill);
      },
      updateSkill: (id, updates) => {
        set((state) => ({
          skills: state.skills.map((sk) => (sk.id === id ? { ...sk, ...updates } : sk)),
        }));
        const target = get().skills.find((sk) => sk.id === id);
        if (target) syncUpsertSkill(target);
      },
      removeSkill: (id) => {
        set((state) => ({ skills: state.skills.filter((sk) => sk.id !== id) }));
        syncDeleteSkill(id);
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [appsResult, skillsResult] = await Promise.all([
          supabase.from('job_applications').select('id, company, position, status, applied_date, link, notes, created_at').eq('user_id', userId),
          supabase.from('skills').select('id, name, category, level, created_at').eq('user_id', userId),
        ]);

        if (appsResult.error || skillsResult.error) return;

        set((state) => {
          const existingAppIds = new Set(state.applications.map((a) => a.id));
          const fetchedApps: JobApplication[] = (appsResult.data ?? [])
            .filter((row) => !existingAppIds.has(row.id))
            .map((row) => ({
              id: row.id,
              company: row.company,
              position: row.position,
              status: row.status as ApplicationStatus,
              appliedDate: row.applied_date,
              link: row.link ?? undefined,
              notes: row.notes ?? undefined,
              createdAt: row.created_at,
            }));

          const existingSkillIds = new Set(state.skills.map((sk) => sk.id));
          const fetchedSkills: Skill[] = (skillsResult.data ?? [])
            .filter((row) => !existingSkillIds.has(row.id))
            .map((row) => ({
              id: row.id,
              name: row.name,
              category: row.category as SkillCategory,
              level: row.level as SkillLevel,
              createdAt: row.created_at,
            }));

          return {
            applications: [...state.applications, ...fetchedApps],
            skills: [...state.skills, ...fetchedSkills],
          };
        });
      },
    }),
    {
      name: "lifesort-career",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);