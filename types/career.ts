export type ApplicationStatus = "applied" | "interview" | "offer" | "rejected";

export interface JobApplication {
  id: string;
  company: string;
  position: string;
  status: ApplicationStatus;
  appliedDate: string;
  link?: string;
  notes?: string;
  createdAt: string;
}

export type SkillCategory = string;
export type SkillLevel = "beginner" | "proficient" | "expert";

export interface Skill {
  id: string;
  name: string;
  category: SkillCategory;
  level: SkillLevel;
  createdAt: string;
}
