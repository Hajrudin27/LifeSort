import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useExpensesStore } from "@/store/useExpensesStore";
import { ExpenseCategory } from "@/types/expense";
import { getCategoryLabel } from "@/utils/expense/expenseCategoryLabel";

export default function CategoryExpensesScreen() {
  const { t } = useTranslation();
  const { category, month } = useLocalSearchParams<{ category: ExpenseCategory; month?: string }>();
  const textMuted = useThemeColor({}, "textMuted");

  const allExpenses = useExpensesStore((s) => s.expenses);
  const expenses = allExpenses.filter(
    (e) => e.category === category && (!month || e.nextPaymentDate.slice(0, 7) === month)
  );
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: getCategoryLabel(category, t) }} />

      <Text style={styles.total}>
        {total.toFixed(2)} {t("expenses.currency")}
      </Text>

      <FlatList
        data={expenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t("expenses.emptyState")}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable
            onLongPress={() =>
              Alert.alert(item.name, undefined, [
                { text: t("expenses.edit"), onPress: () => router.push(`/expenses/edit/${item.id}`) },
                { text: t("expenses.cancel"), style: "cancel" },
              ])
            }>
            <Card style={styles.row}>
              <Text style={styles.name}>{item.name}</Text>
              <Text>{item.amount.toFixed(2)} {t("expenses.currency")}</Text>
            </Card>
          </Pressable>
        )}
      />

      <Button label={t("expenses.addButton")} onPress={() => router.push("/expenses/new")} />
    </View>
  );
}

const styles = {
  total: { fontSize: 26, fontWeight: "800" as const, textAlign: "center" as const, marginBottom: 16 },
  row: { flexDirection: "row" as const, justifyContent: "space-between" as const, alignItems: "center" as const },
  name: { fontWeight: "700" as const },
};