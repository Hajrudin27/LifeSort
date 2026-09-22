import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable, TextInput } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useFoodStore } from "@/store/useFoodStore";
import { useToastStore } from "@/store/useToastStore";
import { INGREDIENT_UNITS, parseIngredientQuantityInput, type IngredientUnit } from '@/core/food/ingredients';
import { formatIngredientQuantity } from '@/utils/food/ingredientFormat';

export default function ShoppingListScreen() {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");
  const textColor = useThemeColor({}, 'text');

  const items = useFoodStore((s) => s.shoppingItems);
  const recipes = useFoodStore((s) => s.recipes);
  const addShoppingItem = useFoodStore((s) => s.addShoppingItem);
  const editShoppingItem = useFoodStore((s) => s.editShoppingItem);
  const toggleShoppingItem = useFoodStore((s) => s.toggleShoppingItem);
  const removeShoppingItem = useFoodStore((s) => s.removeShoppingItem);
  const showToast = useToastStore((s) => s.show);

  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editUnit, setEditUnit] = useState<IngredientUnit>('g');
  const [traceId, setTraceId] = useState<string | null>(null);
  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';
  const beginEdit = (item: typeof items[number]) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    if (item.kind === 'meal_plan') {
      setEditAmount(item.amount.kind === 'structured' ? String(item.amount.quantity) : item.amount.text);
      if (item.amount.kind === 'structured') setEditUnit(item.amount.unit);
    }
  };
  const saveEdit = () => {
    const item = items.find((candidate) => candidate.id === editingId);
    if (!item || !editLabel.trim()) return;
    if (item.kind === 'manual') editShoppingItem(item.id, { label: editLabel.trim() });
    else if (item.amount.kind === 'structured') {
      const quantity = parseIngredientQuantityInput(editAmount);
      if (quantity === null) return;
      editShoppingItem(item.id, { label: editLabel.trim(), amount: { kind: 'structured', quantity, unit: editUnit } });
    } else editShoppingItem(item.id, { label: editLabel.trim(), amount: { ...item.amount, text: editAmount } });
    setEditingId(null);
  };

  const addItem = () => {
    if (newLabel.trim().length === 0) return;
    addShoppingItem(newLabel.trim());
    showToast(t("common.saved"));
    setNewLabel("");
  };

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t("food.shoppingListEmpty")}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <View style={styles.actions}>
              <Pressable accessibilityRole="checkbox" accessibilityLabel={item.label}
                accessibilityState={{ checked: item.checked }} style={styles.checkRow}
                onPress={() => toggleShoppingItem(item.id)}>
                <SymbolView name={{ ios: item.checked ? 'checkmark.square.fill' : 'square',
                  android: item.checked ? 'check_box' : 'check_box_outline_blank', web: item.checked ? 'check_box' : 'check_box_outline_blank' }}
                  tintColor={item.checked ? tintColor : borderColor} size={22} />
                <Text style={[styles.label, item.checked && { color: textMuted, textDecorationLine: 'line-through' }]}>{item.label}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('food.shoppingDerivation.editItem', { name: item.label })}
                onPress={() => beginEdit(item)}><Text>{t('food.pantryEdit')}</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('food.a11y.removeShoppingItem', { item: item.label })}
                onPress={() => removeShoppingItem(item.id)}><Text>{t('food.delete')}</Text></Pressable>
            </View>
            {item.kind === 'meal_plan' && <>
              <Text style={{ color: textMuted }}>{t('food.shoppingDerivation.fromWeek', { week: item.weekKey })}</Text>
              <Text style={{ color: textMuted }}>{item.amount.kind === 'structured'
                ? formatIngredientQuantity(item.amount.quantity, item.amount.unit, locale, (unit) => t(`food.units.${unit}`))
                : t('food.shoppingDerivation.legacyAmount', { text: item.amount.text, count: item.amount.repetitions })}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={t('food.shoppingDerivation.showSources', { name: item.label })}
                onPress={() => setTraceId(traceId === item.id ? null : item.id)}>
                <Text>{t('food.shoppingDerivation.sources', { count: item.provenance.length })}</Text>
              </Pressable>
              {traceId === item.id && item.provenance.map((source, index) => {
                const recipe = recipes.find((candidate) => candidate.id === source.recipeId);
                return <Text key={`${source.recipeId}-${source.day}-${source.mealType}-${source.ingredientIndex}-${index}`} style={{ color: textMuted }}>
                  {recipe?.name ?? t('food.shoppingDerivation.missingRecipe')} · {t(`food.mealTypes.${source.mealType}`)} · {t('food.shoppingDerivation.day', { day: source.day + 1 })} · {source.kind === 'legacy'
                    ? source.amount : formatIngredientQuantity(source.quantity, source.unit, locale, (unit) => t(`food.units.${unit}`))}
                </Text>;
              })}
            </>}
            {editingId === item.id && <View style={styles.editFields}>
              <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]} accessibilityLabel={t('food.shoppingDerivation.label')}
                value={editLabel} onChangeText={setEditLabel} />
              {item.kind === 'meal_plan' && <>
                <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
                  accessibilityLabel={t('food.shoppingDerivation.amount')} value={editAmount} onChangeText={setEditAmount}
                  keyboardType={item.amount.kind === 'structured' ? 'decimal-pad' : 'default'} />
                {item.amount.kind === 'structured' && <View style={styles.actions}>{INGREDIENT_UNITS.map((unit) =>
                  <Pressable key={unit} accessibilityRole="button" accessibilityState={{ selected: editUnit === unit }}
                    onPress={() => setEditUnit(unit)}><Text>{t(`food.units.${unit}`)}</Text></Pressable>)}</View>}
              </>}
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" accessibilityLabel={t('food.save')} onPress={saveEdit}><Text>{t('food.save')}</Text></Pressable>
                <Pressable accessibilityRole="button" onPress={() => setEditingId(null)}><Text>{t('food.cancel')}</Text></Pressable>
              </View>
            </View>}
          </Card>
        )}
      />

      <View style={styles.addRow}>
        <TextInput
          style={[sharedStyles.input, styles.addInput, { borderColor, backgroundColor: surface, color: textColor }]}
          accessibilityLabel={t('food.newShoppingItemPlaceholder')}
          placeholder={t("food.newShoppingItemPlaceholder")}
          placeholderTextColor={borderColor}
          value={newLabel}
          onChangeText={setNewLabel}
          onSubmitEditing={addItem}
        />
        <Pressable accessibilityRole="button" style={[styles.addButton, { borderColor }]} onPress={addItem}>
          <Text style={styles.addButtonText}>{t("food.add")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = {
  itemCard: { gap: 8 },
  actions: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 14 },
  editFields: { gap: 8 },
  checkRow: { flexDirection: "row" as const, flexWrap: 'wrap' as const, alignItems: "center" as const, gap: 10, flex: 1 },
  label: { fontSize: 15 },
  addRow: { flexDirection: "row" as const, gap: 8, marginTop: 12 },
  addInput: { flex: 1 },
  addButton: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, justifyContent: "center" as const },
  addButtonText: { fontWeight: "700" as const },
};
