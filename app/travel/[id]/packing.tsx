import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, StyleSheet, TextInput } from 'react-native';

import RingProgress from '@/components/RingProgress';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useTripsStore } from '@/store/useTripsStore';
import { PackingCategory } from '@/types/trip';
import { getPackingCategoryIcon, PACKING_CATEGORIES } from '@/utils/trip/packingCategory';

const CATEGORY_ORDER: PackingCategory[] = ['essentials', 'clothing', 'electronics', 'toiletries', 'other'];

export default function PackingListScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');
  const success = useThemeColor({}, 'success');

  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === id));
  const allItems = useTripsStore((s) => s.packingItems);
  const items = useMemo(() => allItems.filter((p) => p.tripId === id), [allItems, id]);
  const togglePackingItem = useTripsStore((s) => s.togglePackingItem);
  const addPackingItem = useTripsStore((s) => s.addPackingItem);
  const removePackingItem = useTripsStore((s) => s.removePackingItem);

  const [newLabel, setNewLabel] = useState('');
  const [newCategory, setNewCategory] = useState<PackingCategory>('essentials');

  const addItem = () => {
    if (newLabel.trim().length === 0) return;
    addPackingItem(id!, newLabel.trim(), newCategory);
    setNewLabel('');
  };

  const checkedCount = items.filter((i) => i.checked).length;
  const progress = items.length > 0 ? checkedCount / items.length : 0;
  const isAllPacked = items.length > 0 && checkedCount === items.length;

  const sections = useMemo(() => {
    return CATEGORY_ORDER.map((category) => ({
      title: t(`travel.packingCategories.${category}`),
      category,
      data: items
        .filter((i) => i.category === category)
        .sort((a, b) => Number(a.checked) - Number(b.checked)),
    })).filter((section) => section.data.length > 0);
  }, [items, t]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: trip?.name ?? t('travel.packingLabel') }} />

      <View style={[styles.hero, { backgroundColor: isAllPacked ? success : accentTints.accent, overflow: 'hidden' }]}>
        <View style={[styles.heroCircleLarge, { backgroundColor: '#FFFFFF', opacity: 0.08 }]} />
        <View style={styles.heroContent}>
          <View style={styles.heroRingWrap}>
            <RingProgress progress={progress} size={56} strokeWidth={6} showLabel={false} />
            <View style={styles.heroRingCenter}>
              <SymbolView
                name={isAllPacked ? { ios: 'checkmark', android: 'check', web: 'check' } : { ios: 'bag.fill', android: 'luggage', web: 'luggage' }}
                size={18}
                tintColor="#FFFFFF"
              />
            </View>
          </View>
          <View style={styles.heroTextGroup}>
            <Text style={styles.heroKicker}>
              {isAllPacked ? t('travel.allPackedLabel') : t('travel.packingLabel')}
            </Text>
            <Text style={styles.heroCount}>{checkedCount} / {items.length}</Text>
          </View>
        </View>
      </View>

      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={[styles.emptyCard, { backgroundColor: accentTints.accentSoft }]}>
            <SymbolView name={{ ios: 'bag.fill', android: 'luggage', web: 'luggage' }} size={26} tintColor={accentTints.accent} />
            <Text style={{ color: textMuted, marginTop: 8 }}>{t('travel.noPackingItems')}</Text>
          </View>
        }
        renderSectionHeader={({ section }) => {
          const icon = getPackingCategoryIcon(section.category);
          const done = section.data.filter((i) => i.checked).length;
          return (
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIconCircle, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={icon as any} size={13} tintColor={accentTints.accent} />
              </View>
              <Text style={styles.sectionTitle}>{section.title}</Text>
              <Text style={{ color: textMuted, fontSize: 12 }}>{done}/{section.data.length}</Text>
            </View>
          );
        }}
        renderItem={({ item }) => (
          <Pressable onPress={() => togglePackingItem(item.id)}>
            <View
              style={[
                styles.row,
                {
                  borderColor: item.checked ? success + '55' : accentTints.accentSoft,
                  backgroundColor: item.checked ? success + '14' : 'transparent',
                },
              ]}
            >
              <SymbolView
                name={{
                  ios: item.checked ? 'checkmark.circle.fill' : 'circle',
                  android: item.checked ? 'check_circle' : 'radio_button_unchecked',
                  web: item.checked ? 'check_circle' : 'radio_button_unchecked',
                }}
                tintColor={item.checked ? success : borderColor}
                size={22}
              />
              <Text style={[styles.label, item.checked && { color: textMuted, textDecorationLine: 'line-through' }]}>
                {item.label}
              </Text>
              <Pressable hitSlop={8} onPress={() => removePackingItem(item.id)}>
                <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor={borderColor} />
              </Pressable>
            </View>
          </Pressable>
        )}
      />

      <View style={styles.addSection}>
        <View style={styles.categoryPickerRow}>
          {PACKING_CATEGORIES.map((cat) => {
            const icon = getPackingCategoryIcon(cat);
            const isActive = newCategory === cat;
            return (
              <Pressable
                key={cat}
                accessibilityRole="button"
                accessibilityLabel={t('travel.a11y.selectCategory', { category: t(`travel.packingCategories.${cat}`) })}
                accessibilityState={{ selected: isActive }}
                style={[
                  styles.categoryChip,
                  { borderColor: isActive ? accentTints.accent : borderColor, backgroundColor: isActive ? accentTints.accent : 'transparent' },
                ]}
                onPress={() => setNewCategory(cat)}
              >
                <SymbolView name={icon as any} size={13} tintColor={isActive ? '#FFFFFF' : textMuted} />
              </Pressable>
            );
          })}
        </View>

        <View style={styles.addRow}>
          <TextInput
            style={[styles.input, { borderColor, backgroundColor: surface }]}
            placeholder={t('travel.newPackingItemPlaceholder')}
            placeholderTextColor={borderColor}
            value={newLabel}
            onChangeText={setNewLabel}
            onSubmitEditing={addItem}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('travel.a11y.addPackingItem')}
            style={[styles.addButton, { backgroundColor: accentTints.accent }]}
            onPress={addItem}>
            <SymbolView name={{ ios: 'plus', android: 'add', web: 'add' }} size={18} tintColor="#FFFFFF" />
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  hero: { borderRadius: 20, padding: 18, position: 'relative' },
  heroCircleLarge: { position: 'absolute', width: 140, height: 140, borderRadius: 70, top: -40, right: -30 },
  heroContent: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: 'transparent' },
  heroRingWrap: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  heroRingCenter: { position: 'absolute' },
  heroTextGroup: { backgroundColor: 'transparent' },
  heroKicker: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', opacity: 0.85, textTransform: 'uppercase', letterSpacing: 0.5, backgroundColor: 'transparent' },
  heroCount: { fontSize: 24, fontWeight: '800', color: '#FFFFFF', backgroundColor: 'transparent', marginTop: 2 },
  list: { gap: 6, paddingBottom: 8 },
  emptyCard: { alignItems: 'center', borderRadius: 20, padding: 32, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 6 },
  sectionIconCircle: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '800', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 4 },
  label: { fontSize: 15, flex: 1 },
  addSection: { gap: 8, marginTop: 4 },
  categoryPickerRow: { flexDirection: 'row', gap: 8 },
  categoryChip: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14 },
  addButton: { width: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});