const tintLight = '#B5654A';
const tintDark = '#E0997C';

const Colors = {
  light: {
    text: '#3B2C24',
    textMuted: '#8A7A6D',
    background: '#FBF6F1',
    surface: '#FDF6ED',
    surfaceMuted: '#F0E4D6',
    border: '#E8DDD0',
    tint: tintLight,
    tabIconDefault: '#C9BBAC',
    tabIconSelected: tintLight,
    danger: '#B3453A',
    warning: '#C68A3D',
    success: '#7A8B6F',
  },
  dark: {
    text: '#F5EDE6',
    textMuted: '#B8A99C',
    background: '#241C17',
    surface: '#332822',
    surfaceMuted: '#3D302A',
    border: '#4A3B32',
    tint: tintDark,
    tabIconDefault: '#6B5C51',
    tabIconSelected: tintDark,
    danger: '#E08A7D',
    warning: '#E0A860',
    success: '#9BAE8E',
  },
};

export default Colors;

export const ModuleTints = {
  light: {
    warranties: '#F1DCC9',
    savings: '#EFDCE0',
    expenses: '#F5E1E5',
    travel: '#F3E9DF',
    food: '#F0DCE2',
  },
  dark: {
    warranties: '#4A3A24',
    savings: '#3D2A30',
    expenses: '#3D2A2E',
    travel: '#3A2F27',
    food: '#3A2A30',
  },
};

export const LifeModuleTints = {
  light: {
    todos: '#F1DCC9',
    lifeGoals: '#EFDCE0',
    habits: '#F5E1E5',
    household: '#F3E9DF',
    career: '#F0DCE2',
  },
  dark: {
    todos: '#4A3A24',
    lifeGoals: '#3D2A30',
    habits: '#3D2A2E',
    household: '#3A2F27',
    career: '#3A2A30',
  },
};

export const CycleTints = {
  light: {
    accent: '#C97B8C',
    accentSoft: '#F5E1E5',
    period: '#C05C6E',
    fertile: '#B5654A',
    ovulation: '#D9A441',
  },
  dark: {
    accent: '#E0A3AF',
    accentSoft: '#3D2A2E',
    period: '#D97D8C',
    fertile: '#E0997C',
    ovulation: '#E0B860',
  },
};

export const MasculineTints = {
  light: {
    accent: '#3D6B7D',
    accentSoft: '#DCE8E4',
    period: '#2F5F73',
    fertile: '#4A8768',
    ovulation: '#C9A227',
  },
  dark: {
    accent: '#6FA3B8',
    accentSoft: '#26363A',
    period: '#5B93AA',
    fertile: '#6FAE8C',
    ovulation: '#D9BC5C',
  },
};

export const LifeModuleTintsMasculine = {
  light: {
    todos: '#D9E4E0',
    lifeGoals: '#E0E8DC',
    habits: '#DCE8E4',
    household: '#D9E2E6',
    career: '#DCE6EC',
  },
  dark: {
    todos: '#28322E',
    lifeGoals: '#2A3226',
    habits: '#26332F',
    household: '#28303A',
    career: '#26303A',
  },
};

export const ModuleTintsMasculine = {
  light: {
    warranties: '#D9E4E0',
    savings: '#DCE8E4',
    expenses: '#D9E2E6',
    travel: '#DCE6EC',
    food: '#E0E8DC',
  },
  dark: {
    warranties: '#28322E',
    savings: '#26332F',
    expenses: '#28303A',
    travel: '#26303A',
    food: '#2A3226',
  },
};
// --- Brand-tokens -----------------------------------------------------------
// "Ink"-hero'en (mørkt brandkort med to farvede glød-cirkler) er et bevidst
// mørkt fremhævningskort i BEGGE temaer — derfor er `ink` ens i light/dark.
// Den er stadig defineret pr. tema, så den kan justeres ét sted.
//
// Glød-farverne følger brugerens palet på samme måde som CycleTints/
// MasculineTints, så en maskulin profil ikke får rosa glød og rosa accenter.
// Brug ALDRIG rå hex til disse — hent dem via useBrandTints().

export const BrandTints = {
  light: {
    ink: '#16130F',
    inkDeep: '#15100D',
    glowPrimary: '#E11D48',
    glowSecondary: '#F59E0B',
    onBrand: '#FFFFFF',
    kickerOnBrand: '#FFE4EA',
    veil: 'rgba(255,255,255,0.12)',
    veilMedium: 'rgba(255,255,255,0.18)',
    veilStrong: 'rgba(255,255,255,0.2)',
    hairline: 'rgba(255,255,255,0.08)',
  },
  dark: {
    ink: '#16130F',
    inkDeep: '#15100D',
    glowPrimary: '#E11D48',
    glowSecondary: '#F59E0B',
    onBrand: '#FFFFFF',
    kickerOnBrand: '#FFE4EA',
    veil: 'rgba(255,255,255,0.12)',
    veilMedium: 'rgba(255,255,255,0.18)',
    veilStrong: 'rgba(255,255,255,0.2)',
    hairline: 'rgba(255,255,255,0.08)',
  },
};

export const BrandTintsMasculine = {
  light: {
    ink: '#16130F',
    inkDeep: '#15100D',
    glowPrimary: '#6FA3B8',
    glowSecondary: '#C9A227',
    onBrand: '#FFFFFF',
    kickerOnBrand: '#DCE8E4',
    veil: 'rgba(255,255,255,0.12)',
    veilMedium: 'rgba(255,255,255,0.18)',
    veilStrong: 'rgba(255,255,255,0.2)',
    hairline: 'rgba(255,255,255,0.08)',
  },
  dark: {
    ink: '#16130F',
    inkDeep: '#15100D',
    glowPrimary: '#6FA3B8',
    glowSecondary: '#C9A227',
    onBrand: '#FFFFFF',
    kickerOnBrand: '#DCE8E4',
    veil: 'rgba(255,255,255,0.12)',
    veilMedium: 'rgba(255,255,255,0.18)',
    veilStrong: 'rgba(255,255,255,0.2)',
    hairline: 'rgba(255,255,255,0.08)',
  },
};
