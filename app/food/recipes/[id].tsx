import { router, Stack, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, StyleSheet } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { useFoodStore } from "@/store/useFoodStore";
import { getISOWeekKey } from "@/utils/food/foodWeek";
import { groupMatchesByStore, matchRecipeIngredients } from "@/utils/food/recipeMatching";

export default function RecipeDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");
  const success = useThemeColor({}, "success");

  const recipe = useFoodStore((s) => s.recipes.find((r) => r.id === id));
  const removeRecipe = useFoodStore((s) => s.removeRecipe);
  const allOffers = useFoodStore((s) => s.offers);
  const addShoppingItem = useFoodStore((s) => s.addShoppingItem);

  if (!recipe) {
    return (
      <View style={styles.container}>
        <Text>{t("food.recipesEmpty")}</Text>
      </View>
    );
  }

  const weekKey = getISOWeekKey(new Date());
  const weekOffers = allOffers.filter((o) => o.weekKey === weekKey);
  const matches = matchRecipeIngredients(recipe.ingredients, weekOffers);
  const storeGroups = groupMatchesByStore(matches);
  const unmatched = matches.filter((m) => m.offer === null);

  const addMissingToShoppingList = () => {
    unmatched.forEach((m) => addShoppingItem(m.ingredientName));
  };

  const confirmDelete = () => {
    Alert.alert(t("warranties.deleteConfirmTitle"), t("warranties.deleteConfirmMessage"), [
      { text: t("warranties.cancel"), style: "cancel" },
      {
        text: t("warranties.delete"),
        style: "destructive",
        onPress: () => {
          removeRecipe(recipe.id);
          router.back();
        },
      },
    ]);
  };

  const hasMacros = recipe.calories || recipe.protein || recipe.carbs || recipe.fat;

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={styles.container}>
      <Stack.Screen options={{ title: recipe.name }} />

      <View style={styles.metaRow}>
        {recipe.minutes && <Text style={[styles.minutes, { color: textMuted }]}>{recipe.minutes} min</Text>}
        <Text style={[styles.mealType, { color: textMuted }]}>{t(`food.mealTypes.${recipe.mealType}`)}</Text>
      </View>

      {hasMacros && (
        <Card style={styles.macrosCard}>
          {recipe.calories !== undefined && (
            <View style={styles.macroItem}>
              <Text style={styles.macroValue}>{recipe.calories}</Text>
              <Text style={[styles.macroLabel, { color: textMuted }]}>{t("food.caloriesShort")}</Text>
            </View>
          )}
          {recipe.protein !== undefined && (
            <View style={styles.macroItem}>
              <Text style={styles.macroValue}>{recipe.protein} g</Text>
              <Text style={[styles.macroLabel, { color: textMuted }]}>{t("food.proteinShort")}</Text>
            </View>
          )}
          {recipe.carbs !== undefined && (
            <View style={styles.macroItem}>
              <Text style={styles.macroValue}>{recipe.carbs} g</Text>
              <Text style={[styles.macroLabel, { color: textMuted }]}>{t("food.carbsShort")}</Text>
            </View>
          )}
          {recipe.fat !== undefined && (
            <View style={styles.macroItem}>
              <Text style={styles.macroValue}>{recipe.fat} g</Text>
              <Text style={[styles.macroLabel, { color: textMuted }]}>{t("food.fatShort")}</Text>
            </View>
          )}
        </Card>
      )}

      <Text style={styles.sectionLabel}>{t("food.ingredientsLabel")}</Text>
      {matches.map((m, i) => (
        <Card key={i} style={styles.ingredientRow}>
          <View>
            <Text style={styles.ingredientName}>{m.ingredientName}</Text>
            {m.amount ? <Text style={[styles.ingredientAmount, { color: textMuted }]}>{m.amount}</Text> : null}
          </View>
          <Text style={[styles.matchInfo, { color: m.offer ? success : textMuted }, m.offer && { fontWeight: "700" }]}>
            {m.offer ? t("food.onSaleAt", { store: m.offer.store, price: m.offer.price.toFixed(2) }) : t("food.notOnSale")}
          </Text>
        </Card>
      ))}

      {storeGroups.length > 0 && (
        <>
          <Text style={styles.sectionLabel}>{t("food.whereToBuyLabel")}</Text>
          {storeGroups.map((g) => (
            <Card key={g.store} style={styles.storeCard}>
              <Text style={styles.storeName}>{g.store}</Text>
              <Text style={[styles.storeItems, { color: textMuted }]}>{g.ingredients.join(", ")}</Text>
            </Card>
          ))}
        </>
      )}

      {unmatched.length > 0 && (
        <Button label={t("food.addMissingToList")} variant="secondary" onPress={addMissingToShoppingList} />
      )}

      {recipe.instructions && (
        <>
          <Text style={styles.sectionLabel}>{t("food.recipeInstructionsPlaceholder")}</Text>
          <Card>
            <Text style={styles.instructions}>{recipe.instructions}</Text>
          </Card>
        </>
      )}

      <Button label={t("food.delete")} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 10, paddingBottom: 48 },
  metaRow: { flexDirection: "row", gap: 12, alignItems: "center" },
  minutes: { fontSize: 13 },
  mealType: { fontSize: 13, textTransform: "capitalize" },
  macrosCard: { flexDirection: "row", justifyContent: "space-around" },
  macroItem: { alignItems: "center" },
  macroValue: { fontWeight: "800", fontSize: 15 },
  macroLabel: { fontSize: 11 },
  sectionLabel: { opacity: 0.6, fontSize: 13, marginTop: 8, fontWeight: "600" },
  ingredientRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  ingredientName: { fontWeight: "700" },
  ingredientAmount: { fontSize: 12, marginTop: 1 },
  matchInfo: { fontSize: 12 },
  storeCard: { marginTop: 2 },
  storeName: { fontWeight: "700" },
  storeItems: { fontSize: 13, marginTop: 2 },
  instructions: { lineHeight: 20 },
});