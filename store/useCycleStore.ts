import { newEntityId } from '@/core/ids';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { cycleHealthEncryptedStorage } from '@/core/storage/cycleHealthEncryptedStorage';
import { supabase } from '@/lib/supabase';
import { CycleEntry, FlowIntensity, Symptom, SymptomLog } from '@/types/cycle';
import { HealthConditionRecord, SymptomGlossaryRecord } from '@/types/healthInfo';

async function getUserId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  return userData.user?.id ?? null;
}

function cycleToRow(userId: string, c: CycleEntry) {
  return { id: c.id, user_id: userId, start_date: c.startDate, end_date: c.endDate ?? null, created_at: c.createdAt };
}
function symptomLogToRow(userId: string, l: SymptomLog) {
  return { id: l.id, user_id: userId, date: l.date, symptoms: l.symptoms, flow: l.flow ?? null, notes: l.notes ?? null };
}

async function syncUpsertCycle(cycle: CycleEntry) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('cycles').upsert(cycleToRow(userId, cycle));
}
async function syncDeleteCycle(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('cycles').delete().eq('user_id', userId).eq('id', id);
}

async function syncUpsertSymptomLog(log: SymptomLog) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('symptom_logs').upsert(symptomLogToRow(userId, log));
}
async function syncDeleteSymptomLog(id: string) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('symptom_logs').delete().eq('user_id', userId).eq('id', id);
}

async function syncCycleSettings(updates: Partial<{
  avg_cycle_length: number;
  luteal_phase_length: number;
  reminder_enabled: boolean;
  reminder_days_before: number;
}>) {
  const userId = await getUserId();
  if (!userId) return;
  await supabase.from('cycle_settings').upsert({ user_id: userId, ...updates });
}

interface CycleState {
  cycles: CycleEntry[];
  symptomLogs: SymptomLog[];
  avgCycleLength: number;
  lutealPhaseLength: number;
  reminderEnabled: boolean;
  reminderDaysBefore: number;

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

  fetchFromSupabase: () => Promise<void>;
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
      healthConditions: [],
      symptomGlossary: [],

      startPeriod: (startDate) => {
        const newCycle: CycleEntry = { id: newEntityId(), startDate, createdAt: new Date().toISOString() };
        set((state) => ({ cycles: [...state.cycles, newCycle] }));
        syncUpsertCycle(newCycle);
      },
      endPeriod: (id, endDate) => {
        set((state) => ({
          cycles: state.cycles.map((c) => (c.id === id ? { ...c, endDate } : c)),
        }));
        const target = get().cycles.find((c) => c.id === id);
        if (target) syncUpsertCycle(target);
      },
      updateCycle: (id, updates) => {
        set((state) => ({
          cycles: state.cycles.map((c) => (c.id === id ? { ...c, ...updates } : c)),
        }));
        const target = get().cycles.find((c) => c.id === id);
        if (target) syncUpsertCycle(target);
      },
      removeCycle: (id) => {
        set((state) => ({ cycles: state.cycles.filter((c) => c.id !== id) }));
        syncDeleteCycle(id);
      },

      logSymptoms: (date, symptoms, flow, notes) => {
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
        if (target) syncUpsertSymptomLog(target);
      },
      removeSymptomLog: (id) => {
        set((state) => ({ symptomLogs: state.symptomLogs.filter((l) => l.id !== id) }));
        syncDeleteSymptomLog(id);
      },

      setAvgCycleLength: (days) => {
        set({ avgCycleLength: days });
        syncCycleSettings({ avg_cycle_length: days });
      },
      setLutealPhaseLength: (days) => {
        set({ lutealPhaseLength: days });
        syncCycleSettings({ luteal_phase_length: days });
      },
      setReminderEnabled: (enabled) => {
        set({ reminderEnabled: enabled });
        syncCycleSettings({ reminder_enabled: enabled });
      },
      setReminderDaysBefore: (days) => {
        set({ reminderDaysBefore: days });
        syncCycleSettings({ reminder_days_before: days });
      },

      fetchFromSupabase: async () => {
        const userId = await getUserId();
        if (!userId) return;

        const [cyclesResult, logsResult, settingsResult, conditionsResult, symptomsResult] = await Promise.all([
          supabase.from('cycles').select('id, start_date, end_date, created_at').eq('user_id', userId),
          supabase.from('symptom_logs').select('id, date, symptoms, flow, notes').eq('user_id', userId),
          supabase.from('cycle_settings').select('avg_cycle_length, luteal_phase_length, reminder_enabled, reminder_days_before').eq('user_id', userId).single(),
          // Admin-styret, globalt indhold — ingen user_id-filter, alle brugere ser samme data.
          supabase.from('health_conditions').select('*'),
          supabase.from('symptom_glossary').select('*'),
        ]);

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
    }),
    {
      name: 'lifesort-cycle',
      storage: createJSONStorage(() => cycleHealthEncryptedStorage),
    }
  )
);
