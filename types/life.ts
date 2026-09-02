export type TodoImportance = 'low' | 'medium' | 'high';

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  importance: TodoImportance;
  dueDate?: string;
  completed: boolean;
  createdAt: string;
}

export interface SubGoal {
    id: string;
    title: string;
    completed: boolean;
  }
  
  export interface LifeGoal {
    id: string;
    title: string;
    description?: string;
    deadline?: string;
    subGoals: SubGoal[];
    createdAt: string;
  }

export type HabitDirection = 'build' | 'quit'; // en vane du vil opbygge, eller en du vil af med

export interface HabitLog {
  id: string;
  date: string; // ISO-dato, kun dagen tæller ("2026-08-23")
}

export interface Habit {
  id: string;
  title: string;
  direction: HabitDirection;
  targetPerWeek?: number; // valgfrit mål, fx "3 gange om ugen"
  logs: HabitLog[];
  createdAt: string;
}