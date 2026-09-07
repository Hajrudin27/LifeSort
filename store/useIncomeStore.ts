import i18n from '@/localization/i18n';
import { scheduleIncomeReminder } from '@/utils/expense/incomeReminder';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from '@/lib/supabase';
import { trackSync } from '@/store/useSyncStatusStore';

interface IncomeState {
  incomeByMonth: Record<string, number>; // nøgle: "2026-08"
  setIncomeForMonth: (monthKey: string, amount: number) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function syncIncomeToSupabase(monthKey: string, amount: number) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  await supabase.from('income').upsert({ user_id: userId, month_key: monthKey, amount });
}

export const useIncomeStore = create<IncomeState>()(
  persist(
    (set) => ({
      incomeByMonth: {},

      setIncomeForMonth: (monthKey, amount) => {
        set((state) => ({
          incomeByMonth: { ...state.incomeByMonth, [monthKey]: amount },
        }));
        scheduleIncomeReminder(
          i18n.t('expenses.incomeReminderTitle'),
          i18n.t('expenses.incomeReminderBody')
        );
        syncIncomeToSupabase(monthKey, amount);
      },

      fetchFromSupabase: async () => {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id;
        if (!userId) return;

        const { data, error } = await supabase
          .from('income')
          .select('month_key, amount')
          .eq('user_id', userId);

        if (!trackSync('income', 'fetch', { error })) return;
        if (!data) return;

        set((state) => {
          const merged = { ...state.incomeByMonth };
          for (const row of data) {
            // Kun udfyld måneder, der endnu ikke findes lokalt — en lokal
            // værdi (fx sat lige inden netværket var oppe) skal aldrig
            // overskrives blindt af en ældre serverværdi.
            if (!(row.month_key in merged)) {
              merged[row.month_key] = Number(row.amount);
            }
          }
          return { incomeByMonth: merged };
        });
      },
    }),
    {
      name: "lifesort-income-v2",
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);  