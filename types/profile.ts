export type Gender = 'female' | 'male' | 'other' | 'unspecified';

export interface UserProfile {
  name?: string;
  age?: number;
  gender: Gender;
}