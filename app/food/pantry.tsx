import { useEffect, useMemo, useRef, useState } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, FlatList, Pressable, StyleSheet, TextInput } from 'react-native';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { INGREDIENT_UNITS, parseIngredientQuantityInput, type IngredientUnit } from '@/core/food/ingredients';
import type { PantryItem } from '@/core/food/pantry';
import { parseCalendarDate, todayIso } from '@/utils/shared/localDate';
import { useFoodStore } from '@/store/useFoodStore';
import { useToastStore } from '@/store/useToastStore';
import { formatIngredientQuantity } from '@/utils/food/ingredientFormat';
import { useSoonSuggestions } from '@/features/food/useSoonSuggestions';

type DateField = 'purchasedDate' | 'openedDate' | 'expiryDate';
const DATE_FIELDS: DateField[] = ['purchasedDate', 'openedDate', 'expiryDate'];
const emptyDates = (): Record<DateField, string> => ({ purchasedDate: '', openedDate: '', expiryDate: '' });

export default function PantryScreen() {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textColor = useThemeColor({}, 'text');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');
  const pantryItems = useFoodStore((s) => s.pantryItems);
  const recipes = useFoodStore((s) => s.recipes);
  const [referenceDate, setReferenceDate] = useState(todayIso);
  useEffect(() => {
    const refresh = () => setReferenceDate(todayIso());
    const timer = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const useSoon = useMemo(() => useSoonSuggestions({ pantryItems, recipes, referenceDate }), [pantryItems, recipes, referenceDate]);
  const addPantryItem = useFoodStore((s) => s.addPantryItem);
  const updatePantryItem = useFoodStore((s) => s.updatePantryItem);
  const removePantryItem = useFoodStore((s) => s.removePantryItem);
  const showToast = useToastStore((s) => s.show);
  const listRef = useRef<FlatList<PantryItem>>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState<IngredientUnit | null>(null);
  const [keepLegacy, setKeepLegacy] = useState(false);
  const [dates, setDates] = useState(emptyDates);

  const reset = () => {
    setEditingId(null);
    setName('');
    setQuantity('');
    setUnit(null);
    setKeepLegacy(false);
    setDates(emptyDates());
  };
  const edit = (item: PantryItem) => {
    setEditingId(item.id);
    setName(item.name);
    setQuantity(item.quantity?.toString() ?? '');
    setUnit(item.unit ?? null);
    setKeepLegacy(item.legacyQuantityText !== undefined);
    setDates({ purchasedDate: item.purchasedDate ?? '', openedDate: item.openedDate ?? '', expiryDate: item.expiryDate ?? '' });
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
  };
  const editingItem = pantryItems.find((item) => item.id === editingId);
  const parsedQuantity = quantity.trim()
    ? quantity.trim() === editingItem?.quantity?.toString() ? editingItem.quantity : parseIngredientQuantityInput(quantity)
    : undefined;
  const canSave = name.trim().length > 0 &&
    (quantity.trim() === '' ? unit === null : parsedQuantity !== null && unit !== null) &&
    (!keepLegacy || (quantity.trim() === '' && unit === null)) &&
    DATE_FIELDS.every((field) => !dates[field] || parseCalendarDate(dates[field]) !== null);
  const save = () => {
    if (!canSave) return;
    const input = {
      name: name.trim(),
      ...(parsedQuantity !== undefined && parsedQuantity !== null ? { quantity: parsedQuantity, unit: unit! } : {}),
      ...(dates.purchasedDate ? { purchasedDate: dates.purchasedDate } : {}),
      ...(dates.openedDate ? { openedDate: dates.openedDate } : {}),
      ...(dates.expiryDate ? { expiryDate: dates.expiryDate } : {}),
    };
    if (editingId) updatePantryItem(editingId, input, keepLegacy);
    else addPantryItem(input);
    showToast(t('common.saved'));
    reset();
  };
  const confirmRemove = (item: PantryItem) => Alert.alert(t('food.delete'), undefined, [
    { text: t('warranties.cancel'), style: 'cancel' },
    { text: t('food.delete'), style: 'destructive', onPress: () => { removePantryItem(item.id); if (editingId === item.id) reset(); } },
  ]);
  const dateField = (field: DateField) => (
    <View key={field} style={styles.dateField}>
      <Text style={sharedStyles.fieldLabel}>{t(`food.pantryDates.${field}`)}</Text>
      <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
        accessibilityLabel={t(`food.pantryDates.${field}`)} placeholder={t('food.pantryDateHint')}
        placeholderTextColor={textMuted} autoCapitalize="none" autoCorrect={false} maxLength={10}
        value={dates[field]} onChangeText={(value) => setDates((prev) => ({ ...prev, [field]: value }))} />
      {!!dates[field] && <Pressable accessibilityRole="button"
        accessibilityLabel={t('food.pantryClearDate', { field: t(`food.pantryDates.${field}`) })}
        onPress={() => setDates((prev) => ({ ...prev, [field]: '' }))}>
        <Text style={{ color: textMuted }}>{t('food.pantryClear')}</Text>
      </Pressable>}
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        ref={listRef}
        data={pantryItems}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Card style={styles.useSoonSection}>
            <Text style={styles.sectionTitle}>{t('food.useSoon.title')}</Text>
            <Text style={{ color: textMuted }}>{t('food.useSoon.context')}</Text>
            <Text style={{ color: textMuted }}>{t('food.useSoon.checkLabel')}</Text>
            {useSoon.useSoonItems.length ? useSoon.useSoonItems.map(({ item, expiryDate, daysUntilExpiry }) => (
              <View key={item.id} style={styles.evidenceRow}>
                <Text>{item.name}</Text>
                <Text style={{ color: textMuted }}>{t('food.useSoon.registeredExpiry', { date: expiryDate })} · {daysUntilExpiry === 0
                  ? t('food.useSoon.today') : t('food.useSoon.inDays', { count: daysUntilExpiry })}</Text>
              </View>
            )) : <Text style={{ color: textMuted }}>{t('food.useSoon.noItems')}</Text>}
            {useSoon.suggestions.length ? <>
              <Text style={styles.subheading}>{t('food.useSoon.suggestions')}</Text>
              {useSoon.suggestions.map((suggestion) => (
                <Pressable key={suggestion.recipe.id} accessibilityRole="button"
                  accessibilityLabel={t('food.useSoon.openRecipe', { name: suggestion.recipe.name })}
                  onPress={() => router.push({ pathname: '/food/recipes/[id]', params: { id: suggestion.recipe.id } })}
                  style={[styles.suggestion, { borderColor }]}>
                  <Text style={styles.name}>{suggestion.recipe.name}</Text>
                  <Text style={{ color: textMuted }}>{t('food.useSoon.triggeredBy', {
                    items: suggestion.matchedUseSoonItems.map(({ item, expiryDate }) => t('food.useSoon.triggerItem', {
                      name: item.name, date: expiryDate,
                    })).join(', '),
                  })}</Text>
                  {suggestion.otherPantryMatchedIngredients.length > 0 && <Text style={{ color: textMuted }}>{t('food.useSoon.otherPantryMatches', {
                    items: suggestion.otherPantryMatchedIngredients.map(({ ingredientName }) => ingredientName).join(', '),
                  })}</Text>}
                  {suggestion.notConfirmedIngredientCount > 0 && <Text style={{ color: textMuted }}>{t('food.useSoon.notConfirmed', {
                    count: suggestion.notConfirmedIngredientCount,
                  })}</Text>}
                </Pressable>
              ))}
            </> : <Text style={{ color: textMuted }}>{t('food.useSoon.noSuggestions')}</Text>}
            {useSoon.pastExpiryItems.length > 0 && <>
              <Text style={styles.subheading}>{t('food.useSoon.pastExpiry')}</Text>
              {useSoon.pastExpiryItems.map(({ item, expiryDate }) => (
                <Text key={item.id} style={{ color: textMuted }}>{item.name} · {t('food.useSoon.registeredExpiry', { date: expiryDate })} · {t('food.useSoon.datePassed')}</Text>
              ))}
            </>}
          </Card>
        }
        ListEmptyComponent={<Card style={sharedStyles.emptyCard}><Text style={{ color: textMuted }}>{t('food.pantryEmpty')}</Text></Card>}
        renderItem={({ item }) => (
          <Card style={styles.itemCard}>
            <Text style={styles.name}>{item.name}</Text>
            {item.quantity !== undefined && <Text style={{ color: textMuted }}>
              {formatIngredientQuantity(item.quantity, item.unit!, i18n.language === 'da' ? 'da-DK' : 'en-US', (value) => t(`food.units.${value}`))}
            </Text>}
            {item.legacyQuantityText !== undefined && <Text style={{ color: textMuted }}>
              {t('food.pantryLegacyQuantity', { quantity: item.legacyQuantityText })}
            </Text>}
            {DATE_FIELDS.map((field) => item[field] ? (
              <Text key={field} style={{ color: textMuted }}>{t(`food.pantryDates.${field}`)}: {item[field]}</Text>
            ) : null)}
            <View style={styles.actions}>
              <Pressable accessibilityRole="button" accessibilityLabel={t('food.pantryEditItem', { name: item.name })} onPress={() => edit(item)}>
                <Text style={{ color: textColor }}>{t('food.pantryEdit')}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={t('food.pantryDeleteItem', { name: item.name })} onPress={() => confirmRemove(item)}>
                <Text style={{ color: danger }}>{t('food.delete')}</Text>
              </Pressable>
            </View>
          </Card>
        )}
        ListFooterComponent={
          <Card style={sharedStyles.card}>
            <Text style={styles.name}>{t(editingId ? 'food.pantryEdit' : 'food.add')}</Text>
            <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
              accessibilityLabel={t('food.pantryNamePlaceholder')} placeholder={t('food.pantryNamePlaceholder')}
              placeholderTextColor={textMuted} value={name} onChangeText={setName} />
            {editingId && keepLegacy && <View style={styles.legacyRow}>
              <Text style={{ color: textMuted }}>{t('food.pantryLegacyQuantity', {
                quantity: editingItem?.legacyQuantityText ?? '',
              })}</Text>
              <Pressable accessibilityRole="button" onPress={() => setKeepLegacy(false)}>
                <Text style={{ color: danger }}>{t('food.pantryClear')}</Text>
              </Pressable>
            </View>}
            <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface, color: textColor }]}
              accessibilityLabel={t('food.pantryQuantityPlaceholder')} placeholder={t('food.pantryQuantityPlaceholder')}
              placeholderTextColor={textMuted} keyboardType="decimal-pad" value={quantity}
              onChangeText={(value) => { setQuantity(value); if (value.trim()) setKeepLegacy(false); }} />
            <View style={styles.units}>
              {INGREDIENT_UNITS.map((candidate) => (
                <Pressable key={candidate} accessibilityRole="button" accessibilityState={{ selected: unit === candidate }}
                  onPress={() => setUnit(unit === candidate ? null : candidate)}
                  style={[styles.unit, { borderColor, backgroundColor: unit === candidate ? borderColor : surface }]}>
                  <Text style={{ color: textColor }}>{t(`food.units.${candidate}`)}</Text>
                </Pressable>
              ))}
            </View>
            {DATE_FIELDS.map(dateField)}
            <Button label={t(editingId ? 'food.save' : 'food.add')} disabled={!canSave} onPress={save} />
            {editingId && <Pressable accessibilityRole="button" onPress={reset}>
              <Text style={{ color: textMuted }}>{t('warranties.cancel')}</Text>
            </Pressable>}
          </Card>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  list: { gap: 12, paddingBottom: 40 },
  itemCard: { gap: 5 },
  name: { fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 8 },
  legacyRow: { gap: 6 },
  units: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unit: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  dateField: { gap: 8 },
  useSoonSection: { gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  subheading: { fontSize: 16, fontWeight: '700', marginTop: 6 },
  evidenceRow: { gap: 2 },
  suggestion: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 4 },
});
