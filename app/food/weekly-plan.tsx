import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, StyleSheet } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useFoodStore } from "@/store/useFoodStore";
import { MealType } from "@/types/food";
import { getISOWeekKey, getWeekdayNames, getWeeksInMonth } from "@/utils/food/foodWeek";
import { planWeek, WeekPlan } from "@/utils/food/mealPlanning";
import { getMonthKey } from "@/utils/shared/monthKey";

const MEAL_SLOTS: MealType[] = ["breakfast", "lunch", "dinner"];

export default function WeeklyPlanScreen() {
  const { t, i18n } = useTranslation();
  const { prefillLocks } = useLocalSearchParams<{ prefillLocks?: string }>();
  const borderColor = useThemeColor({}, "border");
  const backgroundColor = useThemeColor({}, "background");
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");
  const warning = useThemeColor({}, "warning");
  const locale = i18n.language === "da" ? "da-DK" : "en-US";

  const recipes = useFoodStore((s) => s.recipes);
  const globalOffers = useFoodStore((s) => s.globalOffers);
  const globalStandardPrices = useFoodStore((s) => s.globalStandardPrices);
  const pantryItems = useFoodStore((s) => s.pantryItems);
  const monthlyBudgetByMonth = useFoodStore((s) => s.monthlyBudgetByMonth);
  const selectedStores = useFoodStore((s) => s.selectedStores);
  const addShoppingItem = useFoodStore((s) => s.addShoppingItem);
  const savePlan = useFoodStore((s) => s.savePlan);

  const monthKey = getMonthKey(new Date());
  const weekKey = getISOWeekKey(new Date());
  const monthlyBudget = monthlyBudgetByMonth[monthKey] ?? null;
  const weeklyBudget = monthlyBudget !== null ? monthlyBudget / getWeeksInMonth(monthKey).length : 0;

  const weekdayNames = getWeekdayNames(locale);
  const [locked, setLocked] = useState<Record<string, string>>({});
  const [pickerSlot, setPickerSlot] = useState<{ day: number; mealType: MealType } | null>(null);
  const [pickerMode, setPickerMode] = useState<"lock" | "swap">("lock");
  const [plan, setPlan] = useState<WeekPlan | null>(null);

  useEffect(() => {
    if (prefillLocks) {
      try {
        setLocked(JSON.parse(prefillLocks));
      } catch {
        // ignorér ugyldig data
      }
    }
  }, [prefillLocks]);

  const slotKey = (day: number, mealType: MealType) => `${day}-${mealType}`;

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
  };

  const sendAllToShoppingList = () => {
    if (!plan) return;
    plan.shoppingList.forEach((entry) => addShoppingItem(entry.ingredientName));
  };

  const slotsByDay = plan ? Array.from({ length: 7 }, (_, day) => plan.slots.filter((s) => s.day === day)) : [];
  const hasUnknownPrices = plan?.shoppingList.some((e) => e.source === "unknown") ?? false;

  const pickerCandidates = pickerSlot ? recipes.filter((r) => r.mealType === pickerSlot.mealType) : [];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={[styles.budgetText, { color: textMuted }]}>
        {t("food.budgetLabel")}: {weeklyBudget.toFixed(2)} kr.
      </Text>

      <Pressable onPress={() => router.push("/food/select-stores")}>
        <Card style={styles.linkRow}>
          <Text style={styles.linkText}>{t("food.selectStoresLabel")}</Text>
          <Text style={[styles.linkMeta, { color: textMuted }]}>
            {selectedStores.length > 0 ? selectedStores.join(", ") : t("food.noStoresSelectedHint")}
          </Text>
        </Card>
      </Pressable>

      <Text style={styles.sectionLabel}>{t("food.lockRecipeLabel")}</Text>
      {Array.from({ length: 7 }, (_, day) => (
        <Card key={day} style={styles.lockDayCard}>
          <Text style={styles.dayName}>{weekdayNames[day]}</Text>
          {MEAL_SLOTS.map((mealType) => {
            const lockedId = locked[slotKey(day, mealType)];
            const lockedRecipe = lockedId ? recipes.find((r) => r.id === lockedId) : null;
            return (
              <Pressable
                key={mealType}
                style={styles.lockRow}
                onPress={() => (lockedRecipe ? unlock(day, mealType) : openPicker(day, mealType, "lock"))}>
                <Text style={[styles.mealTypeLabel, { color: textMuted }]}>{t(`food.mealTypes.${mealType}`)}</Text>
                {lockedRecipe ? (
                  <View style={styles.lockedChip}>
                    <Text style={styles.lockedChipText}>{lockedRecipe.name}</Text>
                    <SymbolView name={{ ios: "lock.fill", android: "lock", web: "lock" }} size={12} tintColor={tintColor} />
                  </View>
                ) : (
                  <Text style={[styles.emptyLockText, { color: textMuted }]}>+</Text>
                )}
              </Pressable>
            );
          })}
        </Card>
      ))}

      <Button label={t("food.generatePlan")} onPress={generate} />

      {plan && (
        <>
          <Text style={styles.totalPrice}>
            {t("food.totalPriceLabel")}: {plan.totalPrice.toFixed(2)} kr.
          </Text>

          {hasUnknownPrices && <Text style={[styles.warning, { color: warning }]}>{t("food.unknownPriceWarning")}</Text>}

          {slotsByDay.map((daySlots, day) => (
            <Card key={day} style={styles.dayCard}>
              <Text style={styles.dayName}>{weekdayNames[day]}</Text>
              {daySlots.map((slot) => (
                <Pressable key={slot.mealType} style={styles.slotRow} onPress={() => slot.recipe && openPicker(slot.day, slot.mealType, "swap")}>
                  <Text style={[styles.mealTypeLabel, { color: textMuted }]}>{t(`food.mealTypes.${slot.mealType}`)}</Text>
                  <Text style={styles.slotRecipe}>
                    {slot.recipe ? slot.recipe.name : t("food.emptySlot")}
                    {slot.locked ? ` (${t("food.lockedTag")})` : ""}
                  </Text>
                </Pressable>
              ))}
            </Card>
          ))}

          {plan.pantryCovered.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t("food.pantryCoveredLabel")}</Text>
              <Card>
                <Text style={{ color: textMuted, fontSize: 13 }}>{plan.pantryCovered.map((p) => p.ingredientName).join(", ")}</Text>
              </Card>
            </>
          )}

          {plan.storeTotals.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t("food.storeTotalsLabel")}</Text>
              {plan.storeTotals.map((st) => (
                <Card key={st.store} style={styles.storeTotalRow}>
                  <Text style={styles.storeTotalName}>{st.store}</Text>
                  <Text style={styles.storeTotalAmount}>{st.total.toFixed(2)} kr.</Text>
                </Card>
              ))}
            </>
          )}

          <Text style={styles.sectionLabel}>{t("food.planShoppingListLabel")}</Text>
          {plan.shoppingList.map((entry, i) => (
            <Card key={i} style={styles.shoppingRow}>
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
            <Text style={styles.modalTitle}>{t("food.chooseRecipeForSlot")}</Text>
            <ScrollView style={styles.modalList}>
              {pickerCandidates.map((r) => (
                <Pressable key={r.id} onPress={() => pickRecipe(r.id)}>
                  <Card style={styles.modalRecipeRow}>
                    <Text>{r.name}</Text>
                  </Card>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 16, gap: 10, paddingBottom: 48 },
  budgetText: { textAlign: "center" },
  linkRow: { gap: 2 },
  linkText: { fontWeight: "700" },
  linkMeta: { fontSize: 12 },
  sectionLabel: { opacity: 0.6, fontSize: 13, marginTop: 8, fontWeight: "600" },
  lockDayCard: { gap: 6 },
  dayName: { fontWeight: "700", textTransform: "capitalize" },
  lockRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  mealTypeLabel: { fontSize: 13 },
  lockedChip: { flexDirection: "row", alignItems: "center", gap: 4 },
  lockedChipText: { fontSize: 13, fontWeight: "700" },
  emptyLockText: { fontSize: 16 },
  totalPrice: { textAlign: "center", fontSize: 18, fontWeight: "800", marginTop: 8 },
  warning: { textAlign: "center", fontSize: 13 },
  dayCard: { gap: 4 },
  slotRow: { flexDirection: "row", justifyContent: "space-between" },
  slotRecipe: { fontSize: 13, fontWeight: "700" },
  storeTotalRow: { flexDirection: "row", justifyContent: "space-between" },
  storeTotalName: { fontWeight: "700" },
  storeTotalAmount: { fontWeight: "700" },
  shoppingRow: { flexDirection: "row", justifyContent: "space-between" },
  ingredientName: { fontWeight: "700" },
  priceText: { fontSize: 13 },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.4)" },
  modalCard: { maxHeight: "70%", borderTopWidth: 1, borderRadius: 20, padding: 16 },
  modalTitle: { fontWeight: "700", fontSize: 16, marginBottom: 8 },
  modalList: { gap: 10 },
  modalRecipeRow: {},
});