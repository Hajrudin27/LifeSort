import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";

import Hero from "@/components/Hero";
import IconGlowCircle from "@/components/IconGlowCircle";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useHomeBackTitle } from "@/hooks/useHomeBackTitle";
import { useFoodStore } from "@/store/useFoodStore";
import { getISOWeekKey, getPreviousWeekKey, getWeeksInMonth } from "@/utils/food/foodWeek";
import { getMonthKey } from "@/utils/shared/monthKey";

export default function FoodScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");
  const success = useThemeColor({}, "success");

  const monthlyBudgetByMonth = useFoodStore((s) => s.monthlyBudgetByMonth);
  const purchases = useFoodStore((s) => s.purchases);
  const addPurchase = useFoodStore((s) => s.addPurchase);
  const savedPlans = useFoodStore((s) => s.savedPlans);
  const offers = useFoodStore((s) => s.offers);
  const pantryItems = useFoodStore((s) => s.pantryItems);
  const shoppingItems = useFoodStore((s) => s.shoppingItems);

  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [dismissedReuse, setDismissedReuse] = useState(false);

  const now = new Date();
  const monthKey = getMonthKey(now);
  const weekKey = getISOWeekKey(now);
  const monthlyBudget = monthlyBudgetByMonth[monthKey] ?? null;
  const weeksInMonth = getWeeksInMonth(monthKey).length;
  const weeklyBudget = monthlyBudget !== null ? monthlyBudget / weeksInMonth : null;

  const spentThisWeek = purchases
    .filter((p) => getISOWeekKey(new Date(p.date)) === weekKey)
    .reduce((sum, p) => sum + p.amount, 0);

  const remaining = weeklyBudget !== null ? weeklyBudget - spentThisWeek : null;
  const isOverBudget = remaining !== null && remaining < 0;

  const canLogPurchase = !isNaN(parseFloat(purchaseAmount)) && parseFloat(purchaseAmount) > 0;

  const logPurchase = () => {
    addPurchase(parseFloat(purchaseAmount));
    setPurchaseAmount("");
  };

  const isSunday = now.getDay() === 0;
  const previousWeekKey = getPreviousWeekKey(now);
  const previousWeekSlots = savedPlans[previousWeekKey] ?? [];
  const hasPreviousPlan = previousWeekSlots.some((s) => s.recipeId !== null);
  const hasCurrentPlan = (savedPlans[weekKey] ?? []).length > 0;
  const showReusePrompt = isSunday && hasPreviousPlan && !hasCurrentPlan && !dismissedReuse;

  const reuseLastWeek = () => {
    const locks: Record<string, string> = {};
    for (const slot of previousWeekSlots) {
      if (slot.recipeId) locks[`${slot.day}-${slot.mealType}`] = slot.recipeId;
    }
    router.push({ pathname: "/food/weekly-plan", params: { prefillLocks: JSON.stringify(locks) } });
  };

  const modules = [
    {
      key: "offers",
      label: t("food.offersLabel"),
      desc: offers.length > 0 ? t("food.offersCount", { count: offers.length }) : t("food.noOffersYet"),
      icon: { ios: "tag.fill", android: "sell", web: "sell" },
      route: "/food/offers",
    },
    {
      key: "recipes",
      label: t("food.recipesLabel"),
      desc: t("food.recipesDesc"),
      icon: { ios: "book.fill", android: "menu_book", web: "menu_book" },
      route: "/food/recipes",
    },
    {
      key: "stores",
      label: t("food.selectStoresLabel"),
      desc: t("food.storesDesc"),
      icon: { ios: "storefront.fill", android: "storefront", web: "storefront" },
      route: "/food/select-stores",
    },
    {
      key: "plan",
      label: t("food.weeklyPlanLabel"),
      desc: hasCurrentPlan ? t("food.planReadyDesc") : t("food.noPlanYetDesc"),
      icon: { ios: "calendar", android: "event", web: "event" },
      route: "/food/weekly-plan",
    },
    {
      key: "pantry",
      label: t("food.pantryLabel"),
      desc: t("food.pantryCount", { count: pantryItems.length }),
      icon: { ios: "cabinet.fill", android: "kitchen", web: "kitchen" },
      route: "/food/pantry",
    },
    {
      key: "shopping",
      label: t("food.shoppingListLabel"),
      desc: t("food.shoppingCount", { count: shoppingItems.filter((i) => !i.checked).length }),
      icon: { ios: "cart.fill", android: "shopping_cart", web: "shopping_cart" },
      route: "/food/shopping-list",
    },
  ];

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.container}>
      <Hero
        color={accentTints.accent}
        icon={{ ios: "cart.fill", android: "shopping_cart", web: "shopping_cart" }}
        kicker={t("food.budgetLabel")}
        value={
          monthlyBudget !== null
            ? `${spentThisWeek.toFixed(0)} / ${weeklyBudget?.toFixed(0)} kr.`
            : t("food.noBudgetSet")
        }
      >
        {monthlyBudget !== null && (
          <Pressable onPress={() => router.push("/food/budget")}>
            <View style={styles.heroProgressWrap}>
              <View style={styles.heroProgressTrack}>
                <View
                  style={[
                    styles.heroProgressFill,
                    {
                      width: `${Math.min((spentThisWeek / (weeklyBudget || 1)) * 100, 100)}%`,
                      backgroundColor: isOverBudget ? '#FFD1D1' : '#FFFFFF',
                    },
                  ]}
                />
              </View>
              <Text style={styles.heroProgressLabel}>
                {isOverBudget
                  ? t("food.weeklyOverBudget", { amount: Math.abs(remaining ?? 0).toFixed(0) })
                  : t("food.weeklyRemaining", { amount: (remaining ?? 0).toFixed(0) })}
              </Text>
            </View>
          </Pressable>
        )}
        {monthlyBudget === null && (
          <Pressable onPress={() => router.push("/food/budget")} style={styles.heroSetBudgetLink}>
            <Text style={styles.heroSetBudgetText}>{t("food.setBudgetLink")}</Text>
            <SymbolView name={{ ios: "arrow.right", android: "arrow_forward", web: "arrow_forward" }} size={12} tintColor="#FFFFFF" />
          </Pressable>
        )}
      </Hero>

      {showReusePrompt && (
        <View style={[styles.reuseCard, { backgroundColor: accentTints.accentSoft }]}>
          <Text style={styles.reuseTitle}>{t("food.reuseLastWeekTitle")}</Text>
          <Text style={[styles.reuseBody, { color: textMuted }]}>{t("food.reuseLastWeekBody")}</Text>
          <View style={styles.reuseButtonRow}>
            <Pressable style={[styles.reuseButton, { backgroundColor: accentTints.accent }]} onPress={reuseLastWeek}>
              <Text style={styles.reuseButtonText}>{t("food.reuseLastWeekButton")}</Text>
            </Pressable>
            <Pressable style={styles.dismissButton} onPress={() => setDismissedReuse(true)}>
              <Text style={[styles.dismissText, { color: textMuted }]}>{t("food.dismiss")}</Text>
            </Pressable>
          </View>
        </View>
      )}

      <Text style={styles.sectionLabel}>{t("food.logPurchase")}</Text>
      <View style={styles.row}>
        <TextInput
          style={[styles.input, styles.flexInput, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.purchaseAmountPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="decimal-pad"
          value={purchaseAmount}
          onChangeText={setPurchaseAmount}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("food.a11y.logPurchase")}
          accessibilityState={{ disabled: !canLogPurchase }}
          style={[styles.smallButton, { backgroundColor: accentTints.accent }, !canLogPurchase && { opacity: 0.4 }]}
          disabled={!canLogPurchase}
          onPress={logPurchase}>
          <SymbolView name={{ ios: "plus", android: "add", web: "add" }} size={18} tintColor="#FFFFFF" />
        </Pressable>
      </View>

      <View style={styles.grid}>
        {modules.map((m) => (
          <Pressable key={m.key} style={styles.gridCell} onPress={() => router.push(m.route as any)}>
            <View style={[styles.moduleCard, { borderColor: accentTints.accentSoft }]}>
              <IconGlowCircle
                icon={m.icon}
                color={accentTints.accent}
                glowColor={accentTints.accentSoft}
                size={38}
              />
              <Text style={styles.moduleLabel}>{m.label}</Text>
              <Text style={{ color: textMuted, fontSize: 11 }} numberOfLines={1}>
                {m.desc}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 32 },
  heroProgressWrap: { marginTop: 14, backgroundColor: "transparent" },
  heroProgressTrack: { height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.25)", overflow: "hidden" },
  heroProgressFill: { height: "100%", borderRadius: 4 },
  heroProgressLabel: { fontSize: 12, color: "#FFFFFF", opacity: 0.9, marginTop: 6, backgroundColor: "transparent" },
  heroSetBudgetLink: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 12, backgroundColor: "transparent" },
  heroSetBudgetText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700", backgroundColor: "transparent" },
  reuseCard: { gap: 8, borderRadius: 18, padding: 14 },
  reuseTitle: { fontWeight: "700" },
  reuseBody: { fontSize: 13 },
  reuseButtonRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  reuseButton: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  reuseButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 13 },
  dismissButton: { paddingVertical: 10, paddingHorizontal: 8 },
  dismissText: { fontSize: 13 },
  sectionLabel: { opacity: 0.6, fontSize: 13, marginTop: 4, fontWeight: "600" },
  row: { flexDirection: "row", gap: 8, alignItems: "center" },
  input: { borderWidth: 1, borderRadius: 12, padding: 14, flex: 1 },
  flexInput: { flex: 1 },
  smallButton: { width: 48, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  gridCell: { width: "47%" },
  moduleCard: { gap: 6, minHeight: 108, borderRadius: 20, padding: 14, borderWidth: 1.5 },
  moduleLabel: { fontSize: 14, fontWeight: "800", marginTop: 2 },
});