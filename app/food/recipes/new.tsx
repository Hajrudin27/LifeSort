import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import {
  INGREDIENT_UNITS,
  parseIngredientQuantityInput,
  unlinkedIngredient,
  type IngredientUnit,
  type UnlinkedRecipeIngredient,
} from "@/core/food/ingredients";
import { useFoodStore } from "@/store/useFoodStore";
import { MealType } from "@/types/food";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner"];

/** One form row. The quantity stays text until it parses; it is never stored as text. */
interface IngredientDraft {
  name: string;
  quantity: string;
  unit: IngredientUnit;
}

const emptyIngredient = (): IngredientDraft => ({ name: "", quantity: "", unit: "g" });

const isNamed = (row: IngredientDraft) => row.name.trim().length > 0;

/**
 * APP-047: named rows become the user's own (unlinked) ingredients — the form
 * never guesses a family from the typed name. Null while any named row lacks a
 * valid quantity, so nothing is saved with an opaque amount.
 */
function draftsToIngredients(rows: IngredientDraft[]): UnlinkedRecipeIngredient[] | null {
  const ingredients: UnlinkedRecipeIngredient[] = [];
  for (const row of rows.filter(isNamed)) {
    const quantity = parseIngredientQuantityInput(row.quantity);
    if (quantity === null) return null;
    ingredients.push(unlinkedIngredient(row.name.trim(), quantity, row.unit));
  }
  return ingredients;
}

export default function NewRecipeScreen() {
  const { t } = useTranslation();
  const addRecipe = useFoodStore((s) => s.addRecipe);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");

  const [name, setName] = useState("");
  const [mealType, setMealType] = useState<MealType>("dinner");
  const [minutes, setMinutes] = useState("");
  const [instructions, setInstructions] = useState("");
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([emptyIngredient()]);
  const [showMacros, setShowMacros] = useState(false);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  const updateIngredient = (index: number, patch: Partial<IngredientDraft>) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, ...patch } : ing)));
  };

  const addIngredientRow = () => setIngredients((prev) => [...prev, emptyIngredient()]);
  const removeIngredientRow = (index: number) => setIngredients((prev) => prev.filter((_, i) => i !== index));

  const cleanedIngredients = draftsToIngredients(ingredients);

  const canSave = name.trim().length > 0 && cleanedIngredients !== null && cleanedIngredients.length > 0;

  const parseOptionalNumber = (v: string) => (v.trim().length > 0 && !isNaN(parseFloat(v)) ? parseFloat(v) : undefined);

  const save = () => {
    if (!cleanedIngredients) return;
    addRecipe({
      name: name.trim(),
      mealType,
      ingredients: cleanedIngredients,
      minutes: parseOptionalNumber(minutes),
      instructions: instructions.trim() || undefined,
      calories: parseOptionalNumber(calories),
      protein: parseOptionalNumber(protein),
      carbs: parseOptionalNumber(carbs),
      fat: parseOptionalNumber(fat),
    });
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.recipeNamePlaceholder")}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />

        <View style={sharedStyles.chipRow}>
          {MEAL_TYPES.map((mt) => (
            <Chip key={mt} label={t(`food.mealTypes.${mt}`)} active={mealType === mt} onPress={() => setMealType(mt)} />
          ))}
        </View>

        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.recipeMinutesPlaceholder")}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          value={minutes}
          onChangeText={setMinutes}
        />

        <Text style={sharedStyles.fieldLabel}>{t("food.ingredientsLabel")}</Text>
        {ingredients.map((ingredient, index) => (
          <View key={index} style={styles.ingredientGroup}>
            <View style={styles.ingredientRow}>
              <TextInput
                style={[sharedStyles.input, styles.nameInput, { borderColor, backgroundColor: surface }]}
                placeholder={t("food.ingredientPlaceholder")}
                placeholderTextColor={borderColor}
                value={ingredient.name}
                onChangeText={(v) => updateIngredient(index, { name: v })}
              />
              <TextInput
                style={[sharedStyles.input, styles.amountInput, { borderColor, backgroundColor: surface }]}
                placeholder={t("food.ingredientQuantityPlaceholder")}
                placeholderTextColor={borderColor}
                keyboardType="decimal-pad"
                value={ingredient.quantity}
                onChangeText={(v) => updateIngredient(index, { quantity: v })}
              />
              {ingredients.length > 1 && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t("food.a11y.removeIngredient")}
                  hitSlop={14}
                  onPress={() => removeIngredientRow(index)}>
                  <SymbolView name={{ ios: "xmark", android: "close", web: "close" }} size={16} tintColor={borderColor} />
                </Pressable>
              )}
            </View>
            <View style={styles.unitRow}>
              {INGREDIENT_UNITS.map((unit) => (
                <Chip
                  key={unit}
                  label={t(`food.units.${unit}`)}
                  accessibilityLabel={t(`food.a11y.units.${unit}`)}
                  active={ingredient.unit === unit}
                  onPress={() => updateIngredient(index, { unit })}
                />
              ))}
            </View>
            {isNamed(ingredient) && parseIngredientQuantityInput(ingredient.quantity) === null && (
              <Text accessibilityLiveRegion="polite" style={[styles.quantityHint, { color: textMuted }]}>
                {t("food.ingredientQuantityHint")}
              </Text>
            )}
          </View>
        ))}
        <Pressable accessibilityRole="button" onPress={addIngredientRow}>
          <Text style={[styles.addLink, { color: textMuted }]}>{t("food.addIngredient")}</Text>
        </Pressable>

        {showMacros ? (
          <>
            <Text style={sharedStyles.fieldLabel}>{t("food.macrosLabel")}</Text>
            <View style={styles.macrosRow}>
              <TextInput
                style={[sharedStyles.input, styles.macroInput, { borderColor, backgroundColor: surface }]}
                placeholder={t("food.caloriesShort")}
                placeholderTextColor={borderColor}
                keyboardType="number-pad"
                value={calories}
                onChangeText={setCalories}
              />
              <TextInput
                style={[sharedStyles.input, styles.macroInput, { borderColor, backgroundColor: surface }]}
                placeholder={t("food.proteinShort")}
                placeholderTextColor={borderColor}
                keyboardType="number-pad"
                value={protein}
                onChangeText={setProtein}
              />
              <TextInput
                style={[sharedStyles.input, styles.macroInput, { borderColor, backgroundColor: surface }]}
                placeholder={t("food.carbsShort")}
                placeholderTextColor={borderColor}
                keyboardType="number-pad"
                value={carbs}
                onChangeText={setCarbs}
              />
              <TextInput
                style={[sharedStyles.input, styles.macroInput, { borderColor, backgroundColor: surface }]}
                placeholder={t("food.fatShort")}
                placeholderTextColor={borderColor}
                keyboardType="number-pad"
                value={fat}
                onChangeText={setFat}
              />
            </View>
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowMacros(true)}>
            <Text style={[styles.addLink, { color: textMuted }]}>+ {t("food.showMacros")}</Text>
          </Pressable>
        )}

        <TextInput
          style={[sharedStyles.input, styles.instructionsInput, { borderColor, backgroundColor: surface }]}
          placeholder={t("food.recipeInstructionsPlaceholder")}
          placeholderTextColor={borderColor}
          value={instructions}
          onChangeText={setInstructions}
          multiline
        />
      </Card>

      <Button label={t("food.save")} disabled={!canSave} onPress={save} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  instructionsInput: { minHeight: 100, textAlignVertical: "top" },
  ingredientGroup: { gap: 6 },
  ingredientRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nameInput: { flex: 2 },
  amountInput: { flex: 1 },
  unitRow: { flexDirection: "row", gap: 6 },
  quantityHint: { fontSize: 12 },
  addLink: { fontSize: 13, marginTop: -2 },
  macrosRow: { flexDirection: "row", gap: 8 },
  macroInput: { flex: 1 },
});