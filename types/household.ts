export type TaskKind = 'cleaning' | 'maintenance';
export type TaskFrequency = 'weekly' | 'monthly' | 'quarterly' | 'yearly';
export type TaskAssignee = 'me' | 'partner';

export interface HouseholdTask {
  id: string;
  kind: TaskKind;
  title: string;
  frequency: TaskFrequency;
  lastDone?: string; // ISO-dato
  assignedTo: TaskAssignee;
  rotates: boolean; // skifter automatisk til den anden person, når opgaven markeres som gjort
  createdAt: string;
  /** Fixed IANA zone for new tasks; null preserves legacy device-local semantics. */
  timeZone: string | null;
}

/** Server-owned sync metadata, deliberately separate from editable task content. */
export interface HouseholdTaskSyncState {
  revision: string;
  plannedRevision: string;
  updatedAt: string;
  deletedAt: string | null;
  /** Last server-confirmed content at `revision`: the base for conflict resolution. */
  confirmed?: HouseholdTask;
}

export interface HouseholdItem {
  id: string;
  label: string;
  checked: boolean;
}

/** Proof that a row was copied from a bundled Moving template. Absent means user-created. */
export interface MovingTemplateRef {
  templateId: string;
  templateVersion: number;
  templateItemId: string;
}

export interface MovingItem {
  id: string;
  label: string;
  checked: boolean;
  templateRef?: MovingTemplateRef;
}

/** The latest template version explicitly applied to the one current checklist. */
export interface MovingTemplateMarker {
  id: string;
  version: number;
}
