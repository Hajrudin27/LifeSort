import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, TextInput } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { formatDkk, moneyLocaleFor } from "@/core/money/format";
import { sumMinorUnits } from "@/core/money/minorUnits";
import { useExpensesStore } from "@/store/useExpensesStore";
import { getCategoryLabel } from "@/utils/expense/expenseCategoryLabel";

export default function SearchExpensesScreen() {
  const { t, i18n } = useTranslation();
  const locale = moneyLocaleFor(i18n.language);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");
  const allExpenses = useExpensesStore((s) => s.expenses);

  const [query, setQuery] = useState("");

  const trimmedQuery = query.trim().toLowerCase();
  const results =
    trimmedQuery.length === 0
      ? []
      : allExpenses
          .filter((e) => e.name.toLowerCase().includes(trimmedQuery))
          .sort((a, b) => b.nextPaymentDate.localeCompare(a.nextPaymentDate));

  // Sum over the displayed search results only, in øre.
  const total = sumMinorUnits(results.map((e) => e.amount));

  return (
    <View style={sharedStyles.formContainerScroll}>
      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t("expenses.searchPlaceholder")}
        placeholderTextColor={borderColor}
        value={query}
        onChangeText={setQuery}
        autoFocus
      />

      {results.length > 0 && (
        <Text style={[styles.total, { color: textMuted }]}>
          {t("expenses.searchTotal", { amount: formatDkk(total, locale) })}
        </Text>
      )}

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          trimmedQuery.length > 0 ? <Text style={[sharedStyles.emptyState, { color: textMuted }]}>{t("expenses.searchEmpty")}</Text> : null
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: "/expenses/[category]",
                params: { category: item.category, month: item.nextPaymentDate.slice(0, 7) },
              })
            }>
            <Card style={sharedStyles.rowBetween}>
              <View style={styles.rowText}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={[styles.meta, { color: textMuted }]}>
                  {item.nextPaymentDate} · {getCategoryLabel(item.category, t)}
                </Text>
              </View>
              <Text style={styles.amount}>{formatDkk(item.amount, locale)}</Text>
            </Card>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = {
  total: { textAlign: "center" as const },
  rowText: { flex: 1 },
  name: { fontWeight: "700" as const },
  meta: { fontSize: 13, marginTop: 2 },
  amount: { fontWeight: "700" as const },
};