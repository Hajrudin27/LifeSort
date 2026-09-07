import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput } from 'react-native';

import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useToastStore } from '@/store/useToastStore';

export default function HouseholdShoppingListScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const tintColor = useThemeColor({}, 'tint');
  const textMuted = useThemeColor({}, 'textMuted');

  const items = useHouseholdStore((s) => s.shoppingItems);
  const addShoppingItem = useHouseholdStore((s) => s.addShoppingItem);
  const toggleShoppingItem = useHouseholdStore((s) => s.toggleShoppingItem);
  const removeShoppingItem = useHouseholdStore((s) => s.removeShoppingItem);
  const showToast = useToastStore((s) => s.show);

  const [newLabel, setNewLabel] = useState('');

  const addItem = () => {
    if (newLabel.trim().length === 0) return;
    addShoppingItem(newLabel.trim());
    showToast(t('common.saved'));
    setNewLabel('');
  };

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('household.shoppingEmpty')}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card style={sharedStyles.rowBetween}>
            <Pressable style={styles.checkRow} onPress={() => toggleShoppingItem(item.id)}>
              <SymbolView
                name={{
                  ios: item.checked ? 'checkmark.square.fill' : 'square',
                  android: item.checked ? 'check_box' : 'check_box_outline_blank',
                  web: item.checked ? 'check_box' : 'check_box_outline_blank',
                }}
                tintColor={item.checked ? tintColor : borderColor}
                size={22}
              />
              <Text style={[styles.label, item.checked && { color: textMuted, textDecorationLine: 'line-through' }]}>
                {item.label}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('household.a11y.removeShoppingItem', { item: item.label })}
              hitSlop={14}
              onPress={() => removeShoppingItem(item.id)}>
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={borderColor} />
            </Pressable>
          </Card>
        )}
      />

      <View style={styles.addRow}>
        <TextInput
          style={[sharedStyles.input, styles.addInput, { borderColor, backgroundColor: surface }]}
          placeholder={t('household.newItemPlaceholder')}
          placeholderTextColor={borderColor}
          value={newLabel}
          onChangeText={setNewLabel}
          onSubmitEditing={addItem}
        />
        <Pressable style={[styles.addButton, { borderColor }]} onPress={addItem}>
          <Text style={styles.addButtonText}>{t('household.add')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = {
  checkRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, flex: 1 },
  label: { fontSize: 15 },
  addRow: { flexDirection: 'row' as const, gap: 8, marginTop: 12 },
  addInput: { flex: 1 },
  addButton: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, justifyContent: 'center' as const },
  addButtonText: { fontWeight: '700' as const },
};