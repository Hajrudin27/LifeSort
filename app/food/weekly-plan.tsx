import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor } from "@/components/Themed";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useFoodStore } from "@/store/useFoodStore";
import { useToastStore } from "@/store/useToastStore";
import { MealType } from "@/types/food";
import { getISOWeekKey, getWeekdayNames, getWeeksInMonth } from "@/utils/food/foodWeek";
import { planWeek, WeekPlan } from "@/utils/food/mealPlanning";
import { getMonthKey } from "@/utils/shared/monthKey";

const MEAL_SLOTS: MealType[] = ["breakfast", "lunch", "dinner"];
const BRAND_INK = "#16130F";
const BRAND_ROSE = "#E11D48";
const BRAND_AMBER = "#F59E0B";

export default function WeeklyPlanScreen() {
  const { t, i18n } = useTranslation();
  const { prefillLocks } = useLocalSearchParams<{ prefillLocks?: string }>();
  const borderColor = useThemeColor({}, "border");
  const backgroundColor = useThemeColor({}, "background");
  const surface = useThemeColor({}, "surface");
  const surfaceMuted = useThemeColor({}, "surfaceMuted");
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");
  const warning = useThemeColor({}, "warning");
  const success = useThemeColor({}, "success");
  const showToast = useToastStore((s) => s.show);
  const locale = i18n.language === "da" ? "da-DK" : "en-US";

  const recipes = useFoodStore((s) => s.recipes);
  const globalOffers = useFoodStore((s) => s.globalOffers);
  const globalStandardPrices = useFoodStore((s) => s.globalStandardPrices);
  const pantryItems = useFoodStore((s) => s.pantryItems);
  const monthlyBudgetByMonth = useFoodStore((s) => s.monthlyBudgetByMonth);
  const selectedStores = useFoodStore((s) => s.selectedStores);
  const shoppingItems = useFoodStore((s) => s.shoppingItems);
  const savedPlans = useFoodStore((s) => s.savedPlans);
  const addShoppingItem = useFoodStore((s) => s.addShoppingItem);
  const savePlan = useFoodStore((s) => s.savePlan);

  const monthKey = getMonthKey(new Date());
  const weekKey = getISOWeekKey(new Date());
  const monthlyBudget = monthlyBudgetByMonth[monthKey] ?? null;
  const weeklyBudget = monthlyBudget !== null ? monthlyBudget / getWeeksInMonth(monthKey).length : 0;
  const savedPlanSlots = savedPlans[weekKey];

  const weekdayNames = getWeekdayNames(locale);
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [pickerSlot, setPickerSlot] = useState<{ day: number; mealType: MealType } | null>(null);
  const [pickerMode, setPickerMode] = useState<"lock" | "swap">("lock");
  const [plan, setPlan] = useState<WeekPlan | null>(null);

  const slotKey = (day: number, mealType: MealType) => `${day}-${mealType}`;
  const lockedCount = Object.keys(locked).length;
  const plannedMealCount = plan?.slots.filter((slot) => slot.recipe).length ?? 0;
  const hasUnknownPrices = plan?.shoppingList.some((e) => e.source === "unknown") ?? false;
  const slotsByDay = plan ? Array.from({ length: 7 }, (_, day) => plan.slots.filter((s) => s.day === day)) : [];
  const pickerCandidates = pickerSlot ? recipes.filter((r) => r.mealType === pickerSlot.mealType) : [];
  const weekLabel = useMemo(() => {
    const now = new Date();
    const end = new Date(now);
    end.setDate(now.getDate() + 6);
    const startLabel = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(now);
    const endLabel = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(end);
    return `${startLabel} - ${endLabel}`;
  }, [locale]);
  const recipeCounts = MEAL_SLOTS.map((mealType) => ({
    mealType,
    count: recipes.filter((recipe) => recipe.mealType === mealType).length,
  }));

  useEffect(() => {
    if (prefillLocks) {
      try {
        setLocked(JSON.parse(prefillLocks));
      } catch {
        // Ignore invalid route data.
      }
    }
  }, [prefillLocks]);

  useEffect(() => {
    if (plan || prefillLocks || !savedPlanSlots?.length || recipes.length === 0) return;
    const restoredLocks: Record<string, string> = {};
    for (const slot of savedPlanSlots) {
      if (slot.recipeId) restoredLocks[slotKey(slot.day, slot.mealType)] = slot.recipeId;
    }
    if (Object.keys(restoredLocks).length === 0) return;
    const restoredPlan = planWeek(recipes, globalOffers, globalStandardPrices, selectedStores, pantryItems, weeklyBudget, restoredLocks);
    setLocked(restoredLocks);
    setPlan(restoredPlan);
  }, [globalOffers, globalStandardPrices, pantryItems, plan, prefillLocks, recipes, savedPlanSlots, selectedStores, weeklyBudget]);

  const openPicker = (day: number, mealType: MealType, mode: "lock" | "swap") => {
    setPickerMode(mode);
    setPickerSlot({ day, mealType });
  };

  const pickRecipe = (recipeId: string) => {
    if (!pickerSlot) return;
    const key = slotKey(pickerSlot.day, pickerSlot.mealType);

    if (pickerMode === "lock") {
      setLocked((prev) => ({ ...prev, [key]: recipeId }));
    } else if (plan) {
      const rebuiltLocks: Record<string, string> = {};
      for (const slot of plan.slots) {
        if (slot.recipe) rebuiltLocks[slotKey(slot.day, slot.mealType)] = slot.recipe.id;
      }
      rebuiltLocks[key] = recipeId;

      const newPlan = planWeek(recipes, globalOffers, globalStandardPrices, selectedStores, pantryItems, weeklyBudget, rebuiltLocks);
      setPlan(newPlan);
      setLocked(rebuiltLocks);
      savePlan(weekKey, newPlan.slots.map((s) => ({ day: s.day, mealType: s.mealType, recipeId: s.recipe?.id ?? null })));
      showToast(t("food.planUpdatedToast"));
    }

    setPickerSlot(null);
  };

  const unlock = (day: number, mealType: MealType) => {
    setLocked((prev) => {
      const next = { ...prev };
      delete next[slotKey(day, mealType)];
      return next;
    });
  };

  const generate = () => {
    const newPlan = planWeek(recipes, globalOffers, globalStandardPrices, selectedStores, pantryItems, weeklyBudget, locked);
    setPlan(newPlan);
    savePlan(weekKey, newPlan.slots.map((s) => ({ day: s.day, mealType: s.mealType, recipeId: s.recipe?.id ?? null })));
    showToast(t("food.planGeneratedToast"));
  };

  const sendAllToShoppingList = () => {
    if (!plan) return;
    plan.shoppingList.forEach((entry) => addShoppingItem(entry.ingredientName));
    showToast(t("food.shoppingListSentToast"));
  };

  return (
    <ScrollView style={[styles.root, { backgroundColor }]} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Card style={[styles.hero, { backgroundColor: BRAND_INK, overflow: "hidden" }]}>
        <View style={[styles.heroRoseGlow, { backgroundColor: BRAND_ROSE }]} />
        <View style={[styles.heroAmberGlow, { backgroundColor: BRAND_AMBER }]} />
        <View style={styles.heroTopRow}>
          <View style={styles.heroIcon}>
            <SymbolView name={{ ios: "calendar.badge.plus", android: "event", web: "event" }} size={24} tintColor="#FFFFFF" />
          </View>
          <View style={styles.heroBadge}>
            <Text style={styles.heroBadgeText}>{weekLabel}</Text>
          </View>
        </View>
        <Text style={styles.heroKicker}>{t("food.weeklyPlanKicker")}</Text>
        <Text style={styles.heroTitle}>{t("food.weeklyPlanHeroTitle")}</Text>
        <Text style={styles.heroSubtitle}>{t("food.weeklyPlanHeroSubtitle")}</Text>
      </Card>

      <View style={styles.statGrid}>
        <View style={[styles.statCard, { backgroundColor: surface, borderColor }]}>
          <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={17} tintColor={BRAND_ROSE} />
          <Text style={styles.statValue}>{recipes.length}</Text>
          <Text style={[styles.statLabel, { color: textMuted }]}>{t("food.recipesLabel")}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: surface, borderColor }]}>
          <SymbolView name={{ ios: "banknote.fill", android: "payments", web: "payments" }} size={17} tintColor={BRAND_AMBER} />
          <Text style={styles.statValue}>{weeklyBudget.toFixed(0)} kr.</Text>
          <Text style={[styles.statLabel, { color: textMuted }]}>{t("food.weeklyBudgetShort")}</Text>
        </View>
        <View style={[styles.statCard, { backgroundColor: surface, borderColor }]}>
          <SymbolView name={{ ios: "cart.fill", android: "shopping_cart", web: "shopping_cart" }} size={17} tintColor={accentTints.accent} />
          <Text style={styles.statValue}>{shoppingItems.filter((item) => !item.checked).length}</Text>
          <Text style={[styles.statLabel, { color: textMuted }]}>{t("food.shoppingShort")}</Text>
        </View>
      </View>

      <View style={styles.actionGrid}>
        <Pressable style={[styles.actionCard, { backgroundColor: surface, borderColor }]} onPress={() => router.push("/food/select-stores")}>
          <SymbolView name={{ ios: "storefront.fill", android: "storefront", web: "storefront" }} size={18} tintColor={accentTints.accent} />
          <View style={styles.actionTextGroup}>
            <Text style={styles.actionTitle}>{t("food.selectStoresLabel")}</Text>
            <Text style={[styles.actionSubtitle, { color: textMuted }]} numberOfLines={1}>
              {selectedStores.length > 0 ? selectedStores.join(", ") : t("food.noStoresSelectedHint")}
            </Text>
          </View>
        </Pressable>

        <Pressable style={[styles.actionCard, { backgroundColor: surface, borderColor }]} onPress={() => router.push("/food/budget")}>
          <SymbolView name={{ ios: "chart.pie.fill", android: "pie_chart", web: "pie_chart" }} size={18} tintColor={BRAND_AMBER} />
          <View style={styles.actionTextGroup}>
            <Text style={styles.actionTitle}>{t("food.budgetLabel")}</Text>
            <Text style={[styles.actionSubtitle, { color: textMuted }]} numberOfLines={1}>
              {monthlyBudget !== null ? `${monthlyBudget.toFixed(0)} kr.` : t("food.noBudgetSet")}
            </Text>
          </View>
        </Pressable>
      </View>

      <View style={styles.sectionHeader}>
        <View>
          <Text style={styles.sectionEyebrow}>{t("food.lockRecipeEyebrow")}</Text>
          <Text style={styles.sectionTitle}>{t("food.lockRecipeTitle")}</Text>
        </View>
        <Text style={[styles.sectionMeta, { color: textMuted }]}>{t("food.lockedCount", { count: lockedCount })}</Text>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.recipeStatsRow}>
        {recipeCounts.map((item) => (
          <View key={item.mealType} style={[styles.recipeStatPill, { backgroundColor: surfaceMuted }]}>
            <Text style={styles.recipeStatValue}>{item.count}</Text>
            <Text style={[styles.recipeStatLabel, { color: textMuted }]}>{t(`food.mealTypes.${item.mealType}`)}</Text>
          </View>
        ))}
      </ScrollView>

      {Array.from({ length: 7 }, (_, day) => (
        <Card key={day} style={[styles.lockDayCard, { borderColor: accentTints.accentSoft }]}>
          <Text style={styles.dayName}>{weekdayNames[day]}</Text>
          <View style={styles.lockRows}>
            {MEAL_SLOTS.map((mealType) => {
              const lockedId = locked[slotKey(day, mealType)];
              const lockedRecipe = lockedId ? recipes.find((r) => r.id === lockedId) : null;
              return (
                <Pressable
                  key={mealType}
                  style={[styles.lockRow, { backgroundColor: lockedRecipe ? accentTints.accentSoft : surfaceMuted }]}
                  onPress={() => (lockedRecipe ? unlock(day, mealType) : openPicker(day, mealType, "lock"))}
                >
                  <Text style={[styles.mealTypeLabel, { color: textMuted }]}>{t(`food.mealTypes.${mealType}`)}</Text>
                  <View style={styles.lockRight}>
                    <Text style={styles.lockValue} numberOfLines={1}>
                      {lockedRecipe ? lockedRecipe.name : t("food.tapToChoose")}
                    </Text>
                    <SymbolView
                      name={{
                        ios: lockedRecipe ? "lock.fill" : "plus",
                        android: lockedRecipe ? "lock" : "add",
                        web: lockedRecipe ? "lock" : "add",
                      }}
                      size={13}
                      tintColor={lockedRecipe ? tintColor : textMuted}
                    />
                  </View>
                </Pressable>
              );
            })}
          </View>
        </Card>
      ))}

      <Button label={plan ? t("food.regeneratePlan") : t("food.generatePlan")} onPress={generate} />

      {plan && (
        <>
          <Card style={[styles.resultHero, { borderColor: accentTints.accentSoft }]}>
            <View style={[styles.resultIcon, { backgroundColor: accentTints.accent }]}>
              <SymbolView name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }} size={20} tintColor="#FFFFFF" />
            </View>
            <View style={styles.resultTextGroup}>
              <Text style={styles.resultTitle}>{t("food.planReadyTitle")}</Text>
              <Text style={[styles.resultSubtitle, { color: textMuted }]}>
                {t("food.planReadySummary", { meals: plannedMealCount, price: plan.totalPrice.toFixed(0) })}
              </Text>
            </View>
          </Card>

          {hasUnknownPrices && <Text style={[styles.warning, { color: warning }]}>{t("food.unknownPriceWarning")}</Text>}

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>{t("food.weekPlanEyebrow")}</Text>
              <Text style={styles.sectionTitle}>{t("food.weeklyPlanLabel")}</Text>
            </View>
          </View>

          {slotsByDay.map((daySlots, day) => (
            <Card key={day} style={styles.dayCard}>
              <Text style={styles.dayName}>{weekdayNames[day]}</Text>
              {daySlots.map((slot) => (
                <Pressable key={slot.mealType} style={styles.slotRow} onPress={() => slot.recipe && openPicker(slot.day, slot.mealType, "swap")}>
                  <Text style={[styles.mealTypeLabel, { color: textMuted }]}>{t(`food.mealTypes.${slot.mealType}`)}</Text>
                  <View style={styles.slotRight}>
                    <Text style={styles.slotRecipe} numberOfLines={1}>
                      {slot.recipe ? slot.recipe.name : t("food.emptySlot")}
                    </Text>
                    {slot.locked && (
                      <View style={[styles.lockedBadge, { backgroundColor: accentTints.accentSoft }]}>
                        <Text style={[styles.lockedBadgeText, { color: tintColor }]}>{t("food.lockedTag")}</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              ))}
            </Card>
          ))}

          {plan.pantryCovered.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t("food.pantryCoveredLabel")}</Text>
              <Card>
                <Text style={{ color: textMuted, fontSize: 13 }}>{plan.pantryCovered.map((p) => p.ingredientName).join(", ")}</Text>
              </Card>
            </>
          )}

          {plan.storeTotals.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>{t("food.storeTotalsLabel")}</Text>
              {plan.storeTotals.map((st) => (
                <Card key={st.store} style={styles.storeTotalRow}>
                  <Text style={styles.storeTotalName}>{st.store}</Text>
                  <Text style={styles.storeTotalAmount}>{st.total.toFixed(2)} kr.</Text>
                </Card>
              ))}
            </>
          )}

          <View style={styles.sectionHeader}>
            <View>
              <Text style={styles.sectionEyebrow}>{t("food.shoppingListEyebrow")}</Text>
              <Text style={styles.sectionTitle}>{t("food.planShoppingListLabel")}</Text>
            </View>
            <Text style={[styles.sectionMeta, { color: textMuted }]}>{plan.shoppingList.length}</Text>
          </View>

          {plan.shoppingList.map((entry, i) => (
            <Card key={`${entry.ingredientName}-${i}`} style={styles.shoppingRow}>
              <Text style={styles.ingredientName}>{entry.ingredientName}</Text>
              <Text style={[styles.priceText, { color: entry.source === "unknown" ? warning : textMuted }]}>
                {entry.price !== null ? `${entry.price.toFixed(2)} kr. (${entry.store})` : t("food.unknownPriceLabel")}
              </Text>
            </Card>
          ))}

          <Button label={t("food.sendToShoppingList")} onPress={sendAllToShoppingList} />
        </>
      )}

      <Modal visible={pickerSlot !== null} animationType="slide" transparent onRequestClose={() => setPickerSlot(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerSlot(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={{ ios: "fork.knife", android: "restaurant", web: "restaurant" }} size={20} tintColor={accentTints.accent} />
              </View>
              <View style={styles.modalTitleGroup}>
                <Text style={styles.modalTitle}>{t("food.chooseRecipeForSlot")}</Text>
                <Text style={[styles.modalSubtitle, { color: textMuted }]}>
                  {pickerSlot ? t(`food.mealTypes.${pickerSlot.mealType}`) : ""}
                </Text>
              </View>
            </View>

            <ScrollView style={styles.modalList} contentContainerStyle={styles.modalListContent}>
              {pickerCandidates.length === 0 ? (
                <Text style={[styles.emptyPickerText, { color: textMuted }]}>{t("food.noRecipesForMealType")}</Text>
              ) : (
                pickerCandidates.map((recipe) => (
                  <Pressable key={recipe.id} onPress={() => pickRecipe(recipe.id)}>
                    <Card style={styles.modalRecipeRow}>
                      <View style={styles.modalRecipeText}>
                        <Text style={styles.modalRecipeName}>{recipe.name}</Text>
                        <Text style={[styles.modalRecipeMeta, { color: textMuted }]}>
                          {recipe.minutes ? `${recipe.minutes} min · ` : ""}
                          {recipe.ingredients.length} {t("food.ingredientsLabel").toLowerCase()}
                        </Text>
                      </View>
                      <SymbolView name={{ ios: "plus.circle.fill", android: "add_circle", web: "add_circle" }} size={20} tintColor={tintColor} />
                    </Card>
                  </Pressable>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
  hero: { borderRadius: 24, gap: 8, padding: 20, position: "relative" },
  heroRoseGlow: { position: "absolute", width: 190, height: 190, borderRadius: 95, top: -86, right: -58, opacity: 0.25 },
  heroAmberGlow: { position: "absolute", width: 130, height: 130, borderRadius: 65, bottom: -48, left: -34, opacity: 0.18 },
  heroTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: "transparent" },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  heroBadge: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  heroBadgeText: { color: "#FFFFFF", fontSize: 12, fontWeight: "800", backgroundColor: "transparent" },
  heroKicker: {
    color: "#FFE4EA",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    backgroundColor: "transparent",
  },
  heroTitle: { color: "#FFFFFF", fontSize: 27, fontWeight: "800", backgroundColor: "transparent" },
  heroSubtitle: { color: "#FFFFFF", fontSize: 14, lineHeight: 20, opacity: 0.85, backgroundColor: "transparent" },
  statGrid: { flexDirection: "row", gap: 10 },
  statCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 12, gap: 5 },
  statValue: { fontSize: 18, fontWeight: "800" },
  statLabel: { fontSize: 11, fontWeight: "700" },
  actionGrid: { flexDirection: "row", gap: 10 },
  actionCard: { flex: 1, borderWidth: 1, borderRadius: 18, padding: 13, gap: 10 },
  actionTextGroup: { gap: 2 },
  actionTitle: { fontSize: 14, fontWeight: "800" },
  actionSubtitle: { fontSize: 12, lineHeight: 17 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginTop: 4 },
  sectionEyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase", opacity: 0.62 },
  sectionTitle: { fontSize: 18, fontWeight: "800" },
  sectionMeta: { fontSize: 12, fontWeight: "800" },
  recipeStatsRow: { gap: 8, paddingRight: 8 },
  recipeStatPill: { flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  recipeStatValue: { fontSize: 13, fontWeight: "800" },
  recipeStatLabel: { fontSize: 12, fontWeight: "700" },
  lockDayCard: { gap: 10, borderWidth: 1.5 },
  dayName: { fontWeight: "800", textTransform: "capitalize", fontSize: 15 },
  lockRows: { gap: 8 },
  lockRow: { borderRadius: 15, paddingHorizontal: 12, paddingVertical: 11, gap: 7 },
  mealTypeLabel: { fontSize: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.3 },
  lockRight: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  lockValue: { flex: 1, fontSize: 14, fontWeight: "800" },
  resultHero: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1.5 },
  resultIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  resultTextGroup: { flex: 1, gap: 2 },
  resultTitle: { fontSize: 18, fontWeight: "800" },
  resultSubtitle: { fontSize: 13, lineHeight: 18 },
  warning: { textAlign: "center", fontSize: 13, fontWeight: "700" },
  dayCard: { gap: 8 },
  slotRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, paddingVertical: 2 },
  slotRight: { flex: 1, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 },
  slotRecipe: { flexShrink: 1, fontSize: 13, fontWeight: "800", textAlign: "right" },
  lockedBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  lockedBadgeText: { fontSize: 10, fontWeight: "800" },
  storeTotalRow: { flexDirection: "row", justifyContent: "space-between" },
  storeTotalName: { fontWeight: "700" },
  storeTotalAmount: { fontWeight: "700" },
  shoppingRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  ingredientName: { flex: 1, fontWeight: "700" },
  priceText: { fontSize: 13, fontWeight: "700" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: {
    maxHeight: "72%",
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  modalHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(120,110,100,0.28)",
    alignSelf: "center",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  modalIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  modalTitleGroup: { flex: 1, gap: 2 },
  modalTitle: { fontWeight: "800", fontSize: 18 },
  modalSubtitle: { fontSize: 13, fontWeight: "700" },
  modalList: { maxHeight: 420 },
  modalListContent: { gap: 10 },
  modalRecipeRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  modalRecipeText: { flex: 1, gap: 2 },
  modalRecipeName: { fontSize: 15, fontWeight: "800" },
  modalRecipeMeta: { fontSize: 12, fontWeight: "700" },
  emptyPickerText: { fontSize: 13, lineHeight: 18 },
});
