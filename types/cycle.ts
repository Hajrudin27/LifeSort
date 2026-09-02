export interface CycleEntry {
    id: string;
    startDate: string; // ISO-dato
    endDate?: string;
    createdAt: string;
  }
  
  export type FlowIntensity = 'spotting' | 'light' | 'medium' | 'heavy';
  
  export type Symptom =
    | 'cramps'
    | 'headache'
    | 'bloating'
    | 'fatigue'
    | 'moodSwings'
    | 'acne'
    | 'backache'
    | 'nausea'
    | 'tenderBreasts'
    | 'other';
  
  export interface SymptomLog {
    id: string;
    date: string; // ISO-dato, kun dagen
    symptoms: Symptom[];
    flow?: FlowIntensity;
    notes?: string;
  }