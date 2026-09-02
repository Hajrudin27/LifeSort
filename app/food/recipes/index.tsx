import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useFoodStore } from "@/store/useFoodStore";
import { MealType } from "@/types/food";
import { getISOWeekKey } from "@/utils/food/foodWeek";
import { matchRecipeIngredients } from "@/utils/food/recipeMatching";

const TABS: (MealType | "all")[] = ["all", "breakfast", "lunch", "dinner"];

export default function RecipesScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, "textMuted");

  const recipes = useFoodStore((s) => s.recipes);
  const allOffers = useFoodStore((s) => s.offers);
  const weekKey = getISOWeekKey(new Date());
  const weekOffers = allOffers.filter((o) => o.weekKey === weekKey);

  const [tab, setTab] = useState<MealType | "all">("all");
  const filtered = tab === "all" ? recipes : recipes.filter((r) => r.mealType === tab);

  return (
    <View style={sharedStyles.formContainer}>
      <View style={sharedStyles.chipRow}>
        {TABS.map((tb) => (
          <Chip key={tb} label={t(`food.mealTypes.${tb}`)} active={tab === tb} onPress={() => setTab(tb)} />
        ))}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t("food.recipesEmpty")}</Text>
          </Card>
        }
        renderItem={({ item }) => {
          const matches = matchRecipeIngredients(item.ingredients, weekOffers);
          const matchedCount = matches.filter((m) => m.offer !== null).length;

          return (
            <Pressable onPress={() => router.push({ pathname: "/food/recipes/[id]", params: { id: item.id } })}>
              <Card style={sharedStyles.card}>
                <Text style={styles.name}>{item.name}</Text>
                <View style={styles.metaRow}>
                  {item.minutes && <Text style={[styles.meta, { color: textMuted }]}>{item.minutes} min</Text>}
                  {item.calories && (
                    <Text style={[styles.meta, { color: textMuted }]}>
                      {item.calories} {t("food.caloriesShort")}
                    </Text>
                  )}
                </View>
                {matchedCount > 0 && (
                  <Text style={styles.matchText}>
                    {t("food.matchedThisWeek", { matched: matchedCount, total: item.ingredients.length })}
                  </Text>
                )}
              </Card>
            </Pressable>
          );
        }}
      />

      <Button label={`+ ${t("food.recipesLabel")}`} onPress={() => router.push("/food/recipes/new")} />
    </View>
  );
}

const styles = {
  name: { fontWeight: "700" as const, fontSize: 16 },
  metaRow: { flexDirection: "row" as const, gap: 12 },
  meta: { fontSize: 13 },
  matchText: { fontSize: 13, fontWeight: "600" as const, marginTop: 2 },
};