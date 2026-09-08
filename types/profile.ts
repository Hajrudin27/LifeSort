export type Gender = 'female' | 'male' | 'other' | 'unspecified';

export interface UserProfile {
  name?: string;
  /**
   * Valgfrit. Bruges i dag til farvetoner og som gate for cyklus-fanen — det
   * sidste er APP-071's at fjerne. Aldrig obligatorisk, aldrig ved oprettelse.
   */
  gender: Gender;
  partnerName?: string; // bruges til opgavefordeling i Hjemmet-modulet
}