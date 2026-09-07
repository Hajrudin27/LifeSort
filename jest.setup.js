/**
 * Testopsætning.
 *
 * AsyncStorage er et native-modul og findes ikke under Jest. Pakkens egen mock
 * bruges, så en test kan importere en store — og dermed også en feature, der
 * læser sin egen store — uden en enhed.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Supabase-klienten oprettes ved import og vil ellers forsøge at nå nettet.
// Testene her rører ikke serveren; de handler om det lokale.
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      upsert: () => Promise.resolve({ error: null }),
    }),
    auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
  },
}));
