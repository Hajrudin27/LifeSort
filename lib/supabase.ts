import { createClient } from '@supabase/supabase-js';
import 'react-native-url-polyfill/auto';

import { waitForStartupStorage } from '@/core/storage/migrations/runtime';
import { secureSessionStorage } from '@/utils/auth/secureSessionStorage';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Sessionen ligger i enhedens nøglering, ikke i AsyncStorage — se
    // utils/auth/secureSessionStorage.ts for hvorfor.
    storage: {
      ...secureSessionStorage,
      // Supabase initializes eagerly on import; do not allow refresh/auth reads
      // to start network work before local migrations finish.
      getItem: async (key: string) => {
        await waitForStartupStorage();
        return secureSessionStorage.getItem(key);
      },
    },
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
