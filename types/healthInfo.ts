// Admin-styret indhold hentet fra Supabase (health_conditions / symptom_glossary) —
// tosprogede felter direkte i databasen i stedet for oversættelsesnøgler, så indholdet
// kan redigeres fra admin-panelet uden en app-udgivelse.
export interface HealthConditionRecord {
  id: string;
  nameDa: string;
  nameEn: string;
  summaryDa: string;
  summaryEn: string;
  whatItIsDa: string;
  whatItIsEn: string;
  commonSymptoms: string[];
  whatHelpsDa: string;
  whatHelpsEn: string;
  whenToSeeDoctorDa: string;
  whenToSeeDoctorEn: string;
}

export interface SymptomGlossaryRecord {
  id: string;
  nameDa: string;
  nameEn: string;
  descriptionDa: string;
  descriptionEn: string;
}