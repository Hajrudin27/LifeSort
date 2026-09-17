import { migrationGatedStorage } from '@/core/storage/migrations/runtime';
import { MoneyError, type MinorUnits } from '@/core/money/minorUnits';
import { minorUnitsToServerNumeric, serverNumericToMinorUnits } from '@/core/money/serverNumeric';
import { supportedMoney } from '@/core/money/supportedMoney';
import i18n from '@/localization/i18n';
import { scheduleIncomeReminder } from '@/utils/expense/incomeReminder';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { supabase } from '@/lib/supabase';
import { trackSync } from '@/store/useSyncStatusStore';

interface IncomeState {
  incomeByMonth: Record<string, MinorUnits>; // nøgle: "2026-08", værdi i øre
  setIncomeForMonth: (monthKey: string, amount: MinorUnits) => void;
  fetchFromSupabase: () => Promise<void>;
}

async function syncIncomeToSupabase(monthKey: string, amount: MinorUnits) {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return;

  await supabase.from('income').upsert({ user_id: userId, month_key: monthKey, amount: minorUnitsToServerNumeric(amount) });
}

export const useIncomeStore = create<IncomeState>()(
  persist(
    (set) => ({
      incomeByMonth: {},

      setIncomeForMonth: (monthKey, amount) => {
        const canonical = supportedMoney(amount); // APP-040: afvises før set()
        set((state) => ({
          incomeByMonth: { ...state.incomeByMonth, [monthKey]: canonical },
        }));
        scheduleIncomeReminder(
          i18n.t('expenses.incomeReminderTitle'),
          i18n.t('expenses.incomeReminderBody')
        );
        syncIncomeToSupabase(monthKey, canonical);
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

        // APP-040: hele serverbilledet konverteres og valideres FØR state røres.
        // Ét ugyldigt beløb afviser hele hentningen med en fast kode.
        let remote: { monthKey: string; amount: MinorUnits }[];
        try {
          remote = (data as { month_key: string; amount: unknown }[]).map((row) => ({
            monthKey: row.month_key,
            amount: serverNumericToMinorUnits(row.amount),
          }));
        } catch {
          trackSync('income', 'fetch', { error: new MoneyError('money_transport_invalid') });
          return;
        }

        set((state) => {
          const merged = { ...state.incomeByMonth };
          for (const row of remote) {
            // Kun udfyld måneder, der endnu ikke findes lokalt — en lokal
            // værdi (fx sat lige inden netværket var oppe) skal aldrig
            // overskrives blindt af en ældre serverværdi.
            if (!(row.monthKey in merged)) {
              merged[row.monthKey] = row.amount;
            }
          }
          return { incomeByMonth: merged };
        });
      },
    }),
    {
      name: "lifesort-income-v2",
      // APP-040 v1: DKK MinorUnits. "-v2" in the key name is not a schema version.
      version: 1,
      storage: createJSONStorage(() => migrationGatedStorage(AsyncStorage)),
    },
  ),
);  