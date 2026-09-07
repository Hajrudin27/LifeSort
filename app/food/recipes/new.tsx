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
import { useFoodStore } from "@/store/useFoodStore";
import { MealType, RecipeIngredient } from "@/types/food";

const MEAL_TYPES: MealType[] = ["breakfast", "lunch", "dinner"];

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
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([{ name: "", amount: "" }]);
  const [showMacros, setShowMacros] = useState(false);
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");
  const [carbs, setCarbs] = useState("");
  const [fat, setFat] = useState("");

  const updateIngredient = (index: number, field: "name" | "amount", value: string) => {
    setIngredients((prev) => prev.map((ing, i) => (i === index ? { ...ing, [field]: value } : ing)));
  };

  const addIngredientRow = () => setIngredients((prev) => [...prev, { name: "", amount: "" }]);
  const removeIngredientRow = (index: number) => setIngredients((prev) => prev.filter((_, i) => i !== index));

  const cleanedIngredients = ingredients
    .map((ing) => ({ name: ing.name.trim(), amount: ing.amount.trim() }))
    .filter((ing) => ing.name.length > 0);

  const canSave = name.trim().length > 0 && cleanedIngredients.length > 0;

  const parseOptionalNumber = (v: string) => (v.trim().length > 0 && !isNaN(parseFloat(v)) ? parseFloat(v) : undefined);

  const save = () => {
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
          <View key={index} style={styles.ingredientRow}>
            <TextInput
              style={[sharedStyles.input, styles.nameInput, { borderColor, backgroundColor: surface }]}
              placeholder={t("food.ingredientPlaceholder")}
              placeholderTextColor={borderColor}
              value={ingredient.name}
              onChangeText={(v) => updateIngredient(index, "name", v)}
            />
            <TextInput
              style={[sharedStyles.input, styles.amountInput, { borderColor, backgroundColor: surface }]}
              placeholder={t("food.ingredientAmountPlaceholder")}
              placeholderTextColor={borderColor}
              value={ingredient.amount}
              onChangeText={(v) => updateIngredient(index, "amount", v)}
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
  ingredientRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  nameInput: { flex: 2 },
  amountInput: { flex: 1 },
  addLink: { fontSize: 13, marginTop: -2 },
  macrosRow: { flexDirection: "row", gap: 8 },
  macroInput: { flex: 1 },
});