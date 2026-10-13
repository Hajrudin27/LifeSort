import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { cycleHealthEncryptedStorage } from '@/core/storage/cycleHealthEncryptedStorage';
import { supabase } from '@/lib/supabase';
import { CycleEntry, FlowIntensity, Symptom, SymptomLog } from '@/types/cycle';
import { HealthConditionRecord, SymptomGlossaryRecord } from '@/types/healthInfo';

let datasetEpoch = 0;

/** Resolved only when an action or fetch runs, so a read-only import does not start the auth flow. */
function initiatingAccountId(): string | null {
  const { useAuthStore } = require('@/store/useAuthStore') as typeof import('@/store/useAuthStore');
  return useAuthStore.getState().session?.user.id ?? null;
}

/**
 * APP-072. The owner is captured when the user acts and travels with the write. After the only
 * await the live session must still be that account; if it switched, the write is dropped. A
 * request that still reaches the server under another session carries the initiator's `user_id`,
 * so the owner RLS refuses it instead of re-owning the health row. This is account isolation
 * only: the writes stay best-effort (no outbox, retry or revisions - APP-076).
 */
async function sessionStillOwnedBy(accountId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getSession();
    return !error && data.session?.user.id === accountId;
  } catch {
    return false;
  }
}

function cycleToRow(userId: string, c: CycleEntry) {
  return { id: c.id, user_id: userId, start_date: c.startDate, end_date: c.endDate ?? null, created_at: c.createdAt };
}
function symptomLogToRow(userId: string, l: SymptomLog) {
  return { id: l.id, user_id: userId, date: l.date, symptoms: l.symptoms, flow: l.flow ?? null, notes: l.notes ?? null };
}

async function syncUpsertCycle(accountId: string | null, cycle: CycleEntry) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('cycles').upsert(cycleToRow(accountId, cycle));
}
async function syncDeleteCycle(accountId: string | null, id: string) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('cycles').delete().eq('user_id', accountId).eq('id', id);
}

async function syncUpsertSymptomLog(accountId: string | null, log: SymptomLog) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('symptom_logs').upsert(symptomLogToRow(accountId, log));
}
async function syncDeleteSymptomLog(accountId: string | null, id: string) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('symptom_logs').delete().eq('user_id', accountId).eq('id', id);
}

async function syncCycleSettings(accountId: string | null, updates: Partial<{
  avg_cycle_length: number;
  luteal_phase_length: number;
  reminder_enabled: boolean;
  reminder_days_before: number;
}>) {
  if (!accountId || !(await sessionStillOwnedBy(accountId))) return;
  await supabase.from('cycle_settings').upsert({ user_id: accountId, ...updates });
}

interface CycleState {
  cycles: CycleEntry[];
  symptomLogs: SymptomLog[];
  avgCycleLength: number;
  lutealPhaseLength: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;
  richNotificationCopyEnabled: boolean;

  // Admin-styret, globalt indhold — samme for alle brugere, ingen user_id-filter.
  healthConditions: HealthConditionRecord[];
  symptomGlossary: SymptomGlossaryRecord[];

  startPeriod: (startDate: string) => void;
  endPeriod: (id: string, endDate: string) => void;
  updateCycle: (id: string, updates: Partial<Pick<CycleEntry, 'startDate' | 'endDate'>>) => void;
  removeCycle: (id: string) => void;

  logSymptoms: (date: string, symptoms: Symptom[], flow?: FlowIntensity, notes?: string) => void;
  removeSymptomLog: (id: string) => void;

  setAvgCycleLength: (days: number) => void;
  setLutealPhaseLength: (days: number) => void;
  setReminderEnabled: (enabled: boolean) => void;
  setReminderDaysBefore: (days: number) => void;
  setRichNotificationCopyEnabled: (enabled: boolean) => void;

  fetchFromSupabase: () => Promise<void>;
  /**
   * Logout / account switch: retires any fetch still in flight and resets the user-owned Cycle state.
   * The reviewed reference content (Profile D) is not the user's and is kept.
   */
  clearLocal: () => void;
}

export const useCycleStore = create<CycleState>()(
  persist(
    (set, get) => ({
      cycles: [],
      symptomLogs: [],
      avgCycleLength: 28,
      lutealPhaseLength: 14,
      reminderEnabled: false,
      reminderDaysBefore: 1,
      richNotificationCopyEnabled: false,
      healthConditions: [],
      symptomGlossary: [],

      startPeriod: (startDate) => {
        const accountId = initiatingAccountId();
        const newCycle: CycleEntry = { id: newEntityId(), startDate, createdAt: new Date().toISOString() };
        set((state) => ({ cycles: [...state.cycles, newCycle] }));
        void syncUpsertCycle(accountId, newCycle);
      },
      endPeriod: (id, endDate) => {
        const accountId = initiatingAccountId();
        set((state) => ({
          cycles: state.cycles.map((c) => (c.id === id ? { ...c, endDate } : c)),
        }));
        const target = get().cycles.find((c) => c.id === id);
        if (target) void syncUpsertCycle(accountId, target);
      },
      updateCycle: (id, updates) => {
        const accountId = initiatingAccountId();
        set((state) => ({
          cycles: state.cycles.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }));
        const target = get().cycles.find((c) => c.id === id);
        if (target) void syncUpsertCycle(accountId, target);
      },
      removeCycle: (id) => {
        const accountId = initiatingAccountId();
        set((state) => ({ cycles: state.cycles.filter((c) => c.id !== id) }));
        void syncDeleteCycle(accountId, id);
      },

      logSymptoms: (date, symptoms, flow, notes) => {
        const accountId = initiatingAccountId();
        set((state) => {
          const existing = state.symptomLogs.find((l) => l.date === date);
          if (existing) {
            return {
              symptomLogs: state.symptomLogs.map((l) => (l.date === date ? { ...l, symptoms, flow, notes } : l)),
            };
          }
          return { symptomLogs: [...state.symptomLogs, { id: newEntityId(), date, symptoms, flow, notes }] };
        });
        const target = get().symptomLogs.find((l) => l.date === date);
        if (target) void syncUpsertSymptomLog(accountId, target);
      },
      removeSymptomLog: (id) => {
        const accountId = initiatingAccountId();
        set((state) => ({ symptomLogs: state.symptomLogs.filter((l) => l.id !== id) }));
        void syncDeleteSymptomLog(accountId, id);
      },

      setAvgCycleLength: (days) => {
        const accountId = initiatingAccountId();
        set({ avgCycleLength: days });
        void syncCycleSettings(accountId, { avg_cycle_length: days });
      },
      setLutealPhaseLength: (days) => {
        const accountId = initiatingAccountId();
        set({ lutealPhaseLength: days });
        void syncCycleSettings(accountId, { luteal_phase_length: days });
      },
      setReminderEnabled: (enabled) => {
        const accountId = initiatingAccountId();
        set({ reminderEnabled: enabled });
        void syncCycleSettings(accountId, { reminder_enabled: enabled });
      },
      setReminderDaysBefore: (days) => {
        const accountId = initiatingAccountId();
        set({ reminderDaysBefore: days });
        void syncCycleSettings(accountId, { reminder_days_before: days });
      },
      // APP-073 / ADR-0060: lock-screen disclosure is a DEVICE choice. It is never written to or read from
      // the cloud, so no fetch can enable it and one device's opt-in never reaches another.
      setRichNotificationCopyEnabled: (enabled) => {
        set({ richNotificationCopyEnabled: enabled });
      },

      fetchFromSupabase: async () => {
        const accountId = initiatingAccountId();
        const epoch = datasetEpoch;
        if (!accountId) return;
        const stillActive = () => epoch === datasetEpoch && initiatingAccountId() === accountId;
        if (!(await sessionStillOwnedBy(accountId)) || !stillActive()) return;

        const [cyclesResult, logsResult, settingsResult, conditionsResult, symptomsResult] = await Promise.all([
          supabase.from('cycles').select('id, start_date, end_date, created_at').eq('user_id', accountId),
          supabase.from('symptom_logs').select('id, date, symptoms, flow, notes').eq('user_id', accountId),
          supabase.from('cycle_settings').select('avg_cycle_length, luteal_phase_length, reminder_enabled, reminder_days_before').eq('user_id', accountId).single(),
          // Admin-styret, globalt indhold — ingen user_id-filter, alle brugere ser samme data.
          supabase.from('health_conditions').select('*'),
          supabase.from('symptom_glossary').select('*'),
        ]);

        // The response belongs to the account that asked. If it logged out or another account
        // signed in while the requests were in flight, nothing of it may reach the store - or, through
        // persist, the encrypted disk store of the next session.
        if (!stillActive() || !(await sessionStillOwnedBy(accountId)) || !stillActive()) return;

        set((state) => {
          const next: Partial<CycleState> = {};

          if (!cyclesResult.error && cyclesResult.data) {
            const existingIds = new Set(state.cycles.map((c) => c.id));
            const fetched: CycleEntry[] = cyclesResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                startDate: row.start_date,
                endDate: row.end_date ?? undefined,
                createdAt: row.created_at,
              }));
            next.cycles = [...state.cycles, ...fetched];
          }

          if (!logsResult.error && logsResult.data) {
            const existingIds = new Set(state.symptomLogs.map((l) => l.id));
            const fetched: SymptomLog[] = logsResult.data
              .filter((row) => !existingIds.has(row.id))
              .map((row) => ({
                id: row.id,
                date: row.date,
                symptoms: row.symptoms ?? [],
                flow: row.flow ?? undefined,
                notes: row.notes ?? undefined,
              }));
            next.symptomLogs = [...state.symptomLogs, ...fetched];
          }

          // Indstillinger overtages kun, hvis brugeren aldrig har rørt dem lokalt
          // (dvs. de står stadig på standardværdierne 28/14) — for at undgå at
          // overskrive en bevidst, allerede foretaget lokal justering.
          if (!settingsResult.error && settingsResult.data) {
            const row = settingsResult.data;
            if (state.avgCycleLength === 28 && state.lutealPhaseLength === 14 && !state.reminderEnabled) {
              next.avgCycleLength = row.avg_cycle_length;
              next.lutealPhaseLength = row.luteal_phase_length;
              next.reminderEnabled = row.reminder_enabled;
              next.reminderDaysBefore = row.reminder_days_before;
            }
          }

          // Admin-styret indhold erstattes altid helt (ikke merge-if-new-id som personlig
          // data) — det skal altid afspejle den nyeste version fra admin-panelet.
          if (!conditionsResult.error && conditionsResult.data) {
            next.healthConditions = conditionsResult.data.map((row) => ({
              id: row.id,
              nameDa: row.name_da,
              nameEn: row.name_en,
              summaryDa: row.summary_da,
              summaryEn: row.summary_en,
              whatItIsDa: row.what_it_is_da,
              whatItIsEn: row.what_it_is_en,
              commonSymptoms: row.common_symptoms ?? [],
              whatHelpsDa: row.what_helps_da,
              whatHelpsEn: row.what_helps_en,
              whenToSeeDoctorDa: row.when_to_see_doctor_da,
              whenToSeeDoctorEn: row.when_to_see_doctor_en,
            }));
          }
          if (!symptomsResult.error && symptomsResult.data) {
            next.symptomGlossary = symptomsResult.data.map((row) => ({
              id: row.id,
              nameDa: row.name_da,
              nameEn: row.name_en,
              descriptionDa: row.description_da,
              descriptionEn: row.description_en,
            }));
          }

          return next;
        });
      },

      clearLocal: () => {
        datasetEpoch += 1;
        set({
          cycles: [],
          symptomLogs: [],
          avgCycleLength: 28,
          lutealPhaseLength: 14,
          reminderEnabled: false,
          reminderDaysBefore: 1,
          richNotificationCopyEnabled: false,
        });
      },
    }),
    {
      name: 'lifesort-cycle',
      storage: createJSONStorage(() => migrationGatedStorage(cycleHealthEncryptedStorage)),
    }
  )
);
