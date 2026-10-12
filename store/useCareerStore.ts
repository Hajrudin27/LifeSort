import { newEntityId } from '@/core/ids';
import { decodeStoredApplications } from '@/core/career/persistedApplication';
import { documentMetadataEncryptedStorage } from '@/core/storage/documentCacheStorage';
import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import {
  applyApplicationEdit,
  createApplication,
  validateApplicationInput,
  type ApplicationErrors,
  type ApplicationInput,
} from '@/features/career/domain/application';
import { JobApplication, Skill, SkillCategory, SkillLevel } from '@/types/career';
import { todayIso } from '@/utils/shared/localDate';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

type SkillEditableFields = Pick<Skill, 'name' | 'category' | 'level'>;

export type ApplicationWriteResult = { ok: true; id: string } | { ok: false; errors: ApplicationErrors };

/**
 * APP-067 — Career is LOCAL-ONLY.
 *
 * `lifesort-career` holds application notes, so the whole key — applications and skills — is
 * written through the AES-GCM Profile-B adapter (ADR-0055). This store has no network code at
 * all: the legacy best-effort Supabase mirror and its automatic fetch are gone, because Profile B
 * needs a reliable sync path (stable mutation ids, revisions, tombstones, conflict policy,
 * account isolation) that does not exist yet and a second, weaker one must not be invented here.
 * The server table `job_applications` is retained, security-hardened and unused by the app.
 *
 * Application writes go through the Career domain: nothing reaches state without validation, the
 * id comes from `newEntityId()`, and `id` / `createdAt` never change after creation.
 */
interface CareerState {
  applications: JobApplication[];
  addApplication: (input: ApplicationInput) => ApplicationWriteResult;
  updateApplication: (id: string, input: ApplicationInput) => ApplicationWriteResult;
  removeApplication: (id: string) => void;
  skills: Skill[];
  addSkill: (input: { name: string; category: SkillCategory; level: SkillLevel }) => void;
  updateSkill: (id: string, updates: Partial<SkillEditableFields>) => void;
  removeSkill: (id: string) => void;
}

export const useCareerStore = create<CareerState>()(
  persist(
    (set, get) => ({
      applications: [],
      addApplication: (input) => {
        const result = validateApplicationInput(input, { today: todayIso() });
        if (!result.ok) return result;
        const application = createApplication(result.value, { id: newEntityId(), createdAt: new Date().toISOString() });
        set((state) => ({ applications: [...state.applications, application] }));
        return { ok: true, id: application.id };
      },
      updateApplication: (id, input) => {
        const original = get().applications.find((a) => a.id === id);
        if (!original) return { ok: false, errors: {} };
        const result = validateApplicationInput(input, { today: todayIso(), existing: original });
        if (!result.ok) return result;
        const edited = applyApplicationEdit(original, result.value);
        set((state) => ({ applications: state.applications.map((a) => (a.id === id ? edited : a)) }));
        return { ok: true, id };
      },
      removeApplication: (id) => {
        set((state) => ({ applications: state.applications.filter((a) => a.id !== id) }));
      },

      skills: [],
      addSkill: (input) => {
        const newSkill: Skill = { id: newEntityId(), createdAt: new Date().toISOString(), ...input };
        set((state) => ({ skills: [...state.skills, newSkill] }));
      },
      updateSkill: (id, updates) => {
        set((state) => ({
          skills: state.skills.map((sk) => (sk.id === id ? { ...sk, ...updates } : sk)),
        }));
      },
      removeSkill: (id) => {
        set((state) => ({ skills: state.skills.filter((sk) => sk.id !== id) }));
      },
    }),
    {
      name: 'lifesort-career',
      storage: createJSONStorage(() => migrationGatedStorage(documentMetadataEncryptedStorage)),
      // Only data is persisted; and what comes back is decoded, never trusted: an unrecognisable
      // application (for example a legacy row with a status the app never offered) is not rendered.
      partialize: (state) => ({ applications: state.applications, skills: state.skills }),
      merge: (persisted, current) => {
        const stored = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as {
          applications?: unknown;
          skills?: unknown;
        };
        return {
          ...current,
          applications: decodeStoredApplications(stored.applications),
          skills: Array.isArray(stored.skills) ? (stored.skills as Skill[]) : current.skills,
        };
      },
    },
  ),
);
