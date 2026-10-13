import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { newEntityId } from '@/core/ids';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { cycleHealthEncryptedStorage } from '@/core/storage/cycleHealthEncryptedStorage';
import { supabase } from '@/lib/supabase';
import { CycleEntry, FlowIntensity, Symptom, SymptomLog } from '@/types/cycle';
import { HealthConditionRecord, SymptomGlossaryRecord } from '@/types/healthInfo';

let datasetEpoch = 0;

type ClinicalContentRow = Record<string, unknown>;

function copenhagenDate(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Copenhagen', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((value) => value.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** `review_due_at` is a Postgres `date`: only a real YYYY-MM-DD may be compared with the Copenhagen day. */
function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * APP-074: database rows are untrusted network input even after RLS. A single malformed,
 * draft, expired, duplicate, or legacy row makes the complete reference refresh ineligible.
 */
function decodeHealthConditions(rows: unknown, today: string): HealthConditionRecord[] | null {
  if (!Array.isArray(rows)) return null;
  const ids = new Set<string>();
  const decoded: HealthConditionRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const value = row as ClinicalContentRow;
    const id = value.id;
    const version = value.content_version;
    const dueAt = value.review_due_at;
    const symptoms = value.common_symptoms;
    if (!nonBlank(id) || ids.has(id) || value.status !== 'published' || !Number.isInteger(version) || (version as number) <= 0
      || !isCalendarDate(dueAt) || dueAt < today || !Array.isArray(symptoms) || !symptoms.every(nonBlank)
      || !nonBlank(value.name_da) || !nonBlank(value.name_en) || !nonBlank(value.summary_da) || !nonBlank(value.summary_en)
      || !nonBlank(value.what_it_is_da) || !nonBlank(value.what_it_is_en) || !nonBlank(value.what_helps_da)
      || !nonBlank(value.what_helps_en) || !nonBlank(value.when_to_see_doctor_da) || !nonBlank(value.when_to_see_doctor_en)) return null;
    ids.add(id);
    decoded.push({
      id, contentVersion: version as number, reviewDueAt: dueAt,
      nameDa: value.name_da, nameEn: value.name_en, summaryDa: value.summary_da, summaryEn: value.summary_en,
      whatItIsDa: value.what_it_is_da, whatItIsEn: value.what_it_is_en, commonSymptoms: [...symptoms],
      whatHelpsDa: value.what_helps_da, whatHelpsEn: value.what_helps_en,
      whenToSeeDoctorDa: value.when_to_see_doctor_da, whenToSeeDoctorEn: value.when_to_see_doctor_en,
    });
  }
  return decoded;
}

function decodeSymptomGlossary(rows: unknown, today: string): SymptomGlossaryRecord[] | null {
  if (!Array.isArray(rows)) return null;
  const ids = new Set<string>();
  const decoded: SymptomGlossaryRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') return null;
    const value = row as ClinicalContentRow;
    const id = value.id;
    const version = value.content_version;
    const dueAt = value.review_due_at;
    if (!nonBlank(id) || ids.has(id) || value.status !== 'published' || !Number.isInteger(version) || (version as number) <= 0
      || !isCalendarDate(dueAt) || dueAt < today || !nonBlank(value.name_da) || !nonBlank(value.name_en)
      || !nonBlank(value.description_da) || !nonBlank(value.description_en)) return null;
    ids.add(id);
    decoded.push({
      id, contentVersion: version as number, reviewDueAt: dueAt,
      nameDa: value.name_da, nameEn: value.name_en, descriptionDa: value.description_da, descriptionEn: value.description_en,
    });
  }
  return decoded;
}

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
  /** Runtime only: a persisted reference cache never establishes eligibility after restart. */
  clinicalContentReady: boolean;

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
      clinicalContentReady: false,

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

        // This is deliberately non-persisted. A new process/session cannot trust old encrypted
        // reference rows, and a failed retry cannot leave a prior response renderable.
        set({ clinicalContentReady: false });
        const today = copenhagenDate();

        const [cyclesResult, logsResult, settingsResult, conditionsResult, symptomsResult] = await Promise.all([
          supabase.from('cycles').select('id, start_date, end_date, created_at').eq('user_id', accountId),
          supabase.from('symptom_logs').select('id, date, symptoms, flow, notes').eq('user_id', accountId),
          supabase.from('cycle_settings').select('avg_cycle_length, luteal_phase_length, reminder_enabled, reminder_days_before').eq('user_id', accountId).single(),
          // APP-074: explicit public contract; RLS is authoritative and these filters duplicate
          // eligibility as client defence in depth.
          supabase.from('health_conditions').select('id, content_version, review_due_at, status, name_da, name_en, summary_da, summary_en, what_it_is_da, what_it_is_en, common_symptoms, what_helps_da, what_helps_en, when_to_see_doctor_da, when_to_see_doctor_en').eq('status', 'published').gte('review_due_at', today),
          supabase.from('symptom_glossary').select('id, content_version, review_due_at, status, name_da, name_en, description_da, description_en').eq('status', 'published').gte('review_due_at', today),
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

          // A refresh is all-or-nothing for the two related shared collections. A successful
          // smaller or empty result is authoritative; a partial/error result clears runtime
          // eligibility rather than making encrypted cached content a fallback.
          const conditions = !conditionsResult.error ? decodeHealthConditions(conditionsResult.data, today) : null;
          const symptoms = !symptomsResult.error ? decodeSymptomGlossary(symptomsResult.data, today) : null;
          if (conditions && symptoms) {
            next.healthConditions = conditions;
            next.symptomGlossary = symptoms;
            next.clinicalContentReady = true;
          } else {
            next.healthConditions = [];
            next.symptomGlossary = [];
            next.clinicalContentReady = false;
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
          clinicalContentReady: false,
        });
      },
    }),
    {
      name: 'lifesort-cycle',
      storage: createJSONStorage(() => migrationGatedStorage(cycleHealthEncryptedStorage)),
      partialize: ({ clinicalContentReady: _clinicalContentReady, ...persisted }) => persisted,
      // The disk copy of the reference rows is a stale legacy cache and is never an input: fetch is not
      // gated on hydration, so a late hydration must neither replace a governed refresh nor grant
      // renderability, and a persisted blob can never claim readiness. Only the runtime may set these.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted as Partial<CycleState>),
        healthConditions: current.healthConditions,
        symptomGlossary: current.symptomGlossary,
        clinicalContentReady: current.clinicalContentReady,
      }),
    }
  )
);
