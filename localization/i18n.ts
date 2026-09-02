import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Dansk
import da_appLock from './locales/da/appLock.json';
import da_auth from './locales/da/auth.json';
import da_backup from './locales/da/backup.json';
import da_career from './locales/da/career.json';
import da_common from './locales/da/common.json';
import da_cv from './locales/da/cv.json';
import da_cycle from './locales/da/cycle.json';
import da_datePicker from './locales/da/datePicker.json';
import da_economy from './locales/da/economy.json';
import da_expenses from './locales/da/expenses.json';
import da_food from './locales/da/food.json';
import da_habits from './locales/da/habits.json';
import da_healthInfo from './locales/da/healthInfo.json';
import da_home from './locales/da/home.json';
import da_household from './locales/da/household.json';
import da_language from './locales/da/language.json';
import da_life from './locales/da/life.json';
import da_lifeGoals from './locales/da/lifeGoals.json';
import da_profile from './locales/da/profile.json';
import da_savings from './locales/da/savings.json';
import da_settings from './locales/da/settings.json';
import da_todos from './locales/da/todos.json';
import da_travel from './locales/da/travel.json';
import da_warranties from './locales/da/warranties.json';

// Engelsk
import en_appLock from './locales/en/appLock.json';
import en_auth from './locales/en/auth.json';
import en_backup from './locales/en/backup.json';
import en_career from './locales/en/career.json';
import en_common from './locales/en/common.json';
import en_cv from './locales/en/cv.json';
import en_cycle from './locales/en/cycle.json';
import en_datePicker from './locales/en/datePicker.json';
import en_economy from './locales/en/economy.json';
import en_expenses from './locales/en/expenses.json';
import en_food from './locales/en/food.json';
import en_habits from './locales/en/habits.json';
import en_healthInfo from './locales/en/healthInfo.json';
import en_home from './locales/en/home.json';
import en_household from './locales/en/household.json';
import en_language from './locales/en/language.json';
import en_life from './locales/en/life.json';
import en_lifeGoals from './locales/en/lifeGoals.json';
import en_profile from './locales/en/profile.json';
import en_savings from './locales/en/savings.json';
import en_settings from './locales/en/settings.json';
import en_todos from './locales/en/todos.json';
import en_travel from './locales/en/travel.json';
import en_warranties from './locales/en/warranties.json';

const resources = {
  da: {
    translation: {
      common: da_common,
      home: da_home,
      economy: da_economy,
      expenses: da_expenses,
      savings: da_savings,
      warranties: da_warranties,
      travel: da_travel,
      food: da_food,
      life: da_life,
      todos: da_todos,
      lifeGoals: da_lifeGoals,
      habits: da_habits,
      household: da_household,
      career: da_career,
      cv: da_cv,
      settings: da_settings,
      language: da_language,
      datePicker: da_datePicker,
      backup: da_backup,
      profile: da_profile,
      cycle: da_cycle,
      healthInfo: da_healthInfo,
      auth: da_auth,
      appLock: da_appLock
    },
  },
  en: {
    translation: {
      common: en_common,
      home: en_home,
      economy: en_economy,
      expenses: en_expenses,
      savings: en_savings,
      warranties: en_warranties,
      travel: en_travel,
      food: en_food,
      life: en_life,
      todos: en_todos,
      lifeGoals: en_lifeGoals,
      habits: en_habits,
      household: en_household,
      career: en_career,
      cv: en_cv,
      settings: en_settings,
      language: en_language,
      datePicker: en_datePicker,
      backup: en_backup,
      profile: en_profile,
      cycle: en_cycle,
      healthInfo: en_healthInfo,
      auth: en_auth,
      appLock: en_appLock
    },
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: 'da',
  fallbackLng: 'da',
  interpolation: { escapeValue: false },
});

export default i18n;