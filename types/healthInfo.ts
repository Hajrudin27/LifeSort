export interface HealthCondition {
    id: string;
    nameKey: string; // oversættelsesnøgle
    summaryKey: string;
    whatItIsKey: string;
    commonSymptomsKeys: string[];
    whatHelpsKey: string;
    whenToSeeDoctorKey: string;
  }
  
  export interface SymptomInfo {
    id: string; // matcher Symptom-typen fra types/cycle.ts, hvor muligt
    nameKey: string;
    descriptionKey: string;
  }