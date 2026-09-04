export type Gender = 'female' | 'male' | 'other' | 'unspecified';

export interface UserProfile {
  name?: string;
  age?: number;
  gender: Gender;
  partnerName?: string; // bruges til opgavefordeling i Hjemmet-modulet
}