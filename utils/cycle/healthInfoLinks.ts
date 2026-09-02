import { HEALTH_CONDITIONS } from '@/data/healthConditions';
import { HealthCondition } from '@/types/healthInfo';

export function getConditionsForSymptom(symptomId: string): HealthCondition[] {
  return HEALTH_CONDITIONS.filter((c) => c.commonSymptomsKeys.includes(symptomId));
}