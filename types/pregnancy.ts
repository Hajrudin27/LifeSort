/** APP-076 Phase A — v1.1 Pregnancy value contracts only. */
export type ReproductiveMode = 'cycle' | 'pregnant' | 'recovery' | 'rebaseline';
export type PregnancyMethod = 'lmp' | 'conception' | 'dueDate';
export type PregnancyDueDateSource = 'user' | 'lmp' | 'scan' | 'clinician';
export type PregnancyOutcome = 'birth' | 'stillbirth' | 'miscarriage' | 'termination' | 'other' | 'preferNotToSay';
export type PregnancySymptom = 'nausea' | 'fatigue' | 'backache' | 'heartburn' | 'swelling' | 'cramps' | 'moodSwings' | 'braxtonHicks' | 'insomnia' | 'other';

export interface PregnancySyncMetadata { revision: number; updatedAt: string; deletedAt?: string; }
export interface PregnancyEntry extends PregnancySyncMetadata {
  id: string; method: PregnancyMethod; lmpDate?: string; conceptionDate?: string; dueDateOverride?: string;
  dueDateSource?: PregnancyDueDateSource; endedAt?: string; outcome?: PregnancyOutcome; outcomeNotes?: string;
  recoveryEndedAt?: string; createdAt: string;
}
export interface PregnancySymptomLog extends PregnancySyncMetadata {
  id: string; pregnancyId: string; date: string; symptoms: PregnancySymptom[]; weightKg?: number;
  bellyMeasurementCm?: number; notes?: string;
}
export interface PregnancyAppointment extends PregnancySyncMetadata {
  id: string; pregnancyId: string; startsAt: string; timeZone: string; title: string; notes?: string;
  completed: boolean; reminderEnabled: boolean;
}
export interface PregnancySettings { recoveryDisplayDays: number; privacyMode: boolean; revision: number; updatedAt: string; }
export interface HealthConsent { id: string; purpose: string; consentVersion: string; grantedAt: string; withdrawnAt?: string; }
