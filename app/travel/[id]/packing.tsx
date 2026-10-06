import { Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, SectionList, StyleSheet, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import RingProgress from '@/components/RingProgress';
import { Text, useThemeColor, View } from '@/components/Themed';
import {
  availablePackingTemplatesForTrip,
  getPackingTemplateByKey,
  packingTemplateKey,
  resolvePackingTemplate,
  SELECTABLE_PACKING_TEMPLATES,
} from '@/features/travel/packingTemplates';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useTripsStore } from '@/store/useTripsStore';
import type { PackingCategory, PackingItem } from '@/types/trip';
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
  const danger = useThemeColor({}, 'danger');

  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === id));
  const myUserId = useTripsStore((s) => s.myUserId);
  const allItems = useTripsStore((s) => s.packingItems);
  const appliedPackingTemplates = useTripsStore((s) => s.appliedPackingTemplates);
  const items = useMemo(() => allItems.filter((p) => p.tripId === id), [allItems, id]);
  const togglePackingItem = useTripsStore((s) => s.togglePackingItem);
  const addPackingItem = useTripsStore((s) => s.addPackingItem);
  const updatePackingItem = useTripsStore((s) => s.updatePackingItem);
  const applyPackingTemplate = useTripsStore((s) => s.applyPackingTemplate);
  const removePackingItem = useTripsStore((s) => s.removePackingItem);

  const [draftLabel, setDraftLabel] = useState('');
  const [draftCategory, setDraftCategory] = useState<PackingCategory>('essentials');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState(
    () => packingTemplateKey(SELECTABLE_PACKING_TEMPLATES[0]),
  );
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templateMessage, setTemplateMessage] = useState<{ kind: 'applied'; count: number } | { kind: 'failed' } | null>(null);
  const templateRequest = useRef(0);
  const availableTemplates = useMemo(
    () => id ? availablePackingTemplatesForTrip(id, appliedPackingTemplates) : [],
    [appliedPackingTemplates, id],
  );
  const selectedTemplate = availableTemplates.find((entry) => packingTemplateKey(entry) === selectedTemplateKey)
    ?? availableTemplates[0]
    ?? null;

  useEffect(() => {
    templateRequest.current += 1;
    setApplyingTemplate(false);
    setTemplateMessage(null);
  }, [id, myUserId]);

  const saveDraft = () => {
    if (!id || draftLabel.trim().length === 0) return;
    const saved = editingId
      ? updatePackingItem(editingId, draftLabel, draftCategory)
      : (addPackingItem(id, draftLabel, draftCategory), true);
    if (!saved) return;
    setDraftLabel('');
    setDraftCategory('essentials');
    setEditingId(null);
  };

  const startEditing = (item: PackingItem) => {
    setEditingId(item.id);
    setDraftLabel(item.label);
    setDraftCategory(item.category);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setDraftLabel('');
    setDraftCategory('essentials');
  };

  const applySelectedTemplate = async () => {
    if (!id) return;
    const definition = selectedTemplate
      ? getPackingTemplateByKey(packingTemplateKey(selectedTemplate))
      : null;
    if (!definition) return;
    const request = ++templateRequest.current;
    const requestAccountId = myUserId;
    setApplyingTemplate(true);
    setTemplateMessage(null);
    const result = await applyPackingTemplate(id, resolvePackingTemplate(definition, t));
    const current = useTripsStore.getState();
    if (request !== templateRequest.current || current.myUserId !== requestAccountId
      || !current.trips.some((candidate) => candidate.id === id)) return;
    setApplyingTemplate(false);
    setTemplateMessage(result.ok
      ? { kind: 'applied', count: result.added }
      : result.reason === 'failed' ? { kind: 'failed' } : null);
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
        ListHeaderComponent={availableTemplates.length > 0 ? (
          <Card style={styles.templateCard}>
            <Text style={styles.templateTitle}>{t('travel.packingTemplateSectionTitle')}</Text>
            <Text style={{ color: textMuted }}>{t('travel.packingTemplateHint')}</Text>
            <View style={styles.templateChips}>
              {availableTemplates.map((entry) => {
                const key = packingTemplateKey(entry);
                return (
                  <Chip
                    key={key}
                    label={t('travel.packingTemplateLabel', {
                      title: t(`travel.packingTemplates.titles.${entry.titleKey}`),
                      version: entry.version,
                    })}
                    active={packingTemplateKey(selectedTemplate ?? entry) === key}
                    onPress={() => {
                      setSelectedTemplateKey(key);
                      setTemplateMessage(null);
                    }}
                  />
                );
              })}
            </View>
            <Button
              label={applyingTemplate ? t('travel.packingTemplateApplying') : t('travel.packingTemplateApply')}
              disabled={applyingTemplate}
              onPress={() => void applySelectedTemplate()}
            />
            {templateMessage?.kind === 'applied' && (
              <Text accessibilityRole="alert" style={{ color: textMuted }}>
                {templateMessage.count === 0
                  ? t('travel.packingTemplateNoNewItems')
                  : t('travel.packingTemplateApplied', { count: templateMessage.count })}
              </Text>
            )}
            {templateMessage?.kind === 'failed' && (
              <Text accessibilityRole="alert" style={{ color: danger }}>
                {t('travel.packingTemplateApplyFailed')}
              </Text>
            )}
          </Card>
        ) : null}
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
          <View
            style={[
              styles.row,
              {
                borderColor: item.checked ? success + '55' : accentTints.accentSoft,
                backgroundColor: item.checked ? success + '14' : 'transparent',
              },
            ]}
          >
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.checked }}
              accessibilityLabel={t('travel.a11y.togglePackingItem', { item: item.label })}
              hitSlop={8}
              onPress={() => togglePackingItem(item.id)}
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
            </Pressable>
            <Text style={[styles.label, item.checked && { color: textMuted, textDecorationLine: 'line-through' }]}>
              {item.label}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('travel.a11y.editPackingItem', { item: item.label })}
              hitSlop={8}
              onPress={() => startEditing(item)}
            >
              <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={15} tintColor={tintColor} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('travel.a11y.removePackingItem', { item: item.label })}
              hitSlop={8}
              onPress={() => {
                if (editingId === item.id) cancelEditing();
                removePackingItem(item.id);
              }}
            >
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={14} tintColor={borderColor} />
            </Pressable>
          </View>
        )}
      />

      <View style={styles.addSection}>
        {editingId && <Text style={styles.editingLabel}>{t('travel.packingEditItem')}</Text>}
        <View style={styles.categoryPickerRow}>
          {PACKING_CATEGORIES.map((cat) => {
            const icon = getPackingCategoryIcon(cat);
            const isActive = draftCategory === cat;
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
                onPress={() => setDraftCategory(cat)}
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
            accessibilityLabel={editingId ? t('travel.packingEditLabel') : t('travel.newPackingItemPlaceholder')}
            value={draftLabel}
            onChangeText={setDraftLabel}
            onSubmitEditing={saveDraft}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={editingId ? t('travel.packingEditSave') : t('travel.a11y.addPackingItem')}
            style={[styles.addButton, { backgroundColor: accentTints.accent }]}
            onPress={saveDraft}>
            <SymbolView
              name={editingId
                ? { ios: 'checkmark', android: 'check', web: 'check' }
                : { ios: 'plus', android: 'add', web: 'add' }}
              size={18}
              tintColor="#FFFFFF"
            />
          </Pressable>
          {editingId && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('travel.packingEditCancel')}
              style={[styles.addButton, { borderColor, borderWidth: 1 }]}
              onPress={cancelEditing}
            >
              <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={borderColor} />
            </Pressable>
          )}
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
  templateCard: { gap: 12, marginBottom: 8 },
  templateTitle: { fontSize: 16, fontWeight: '800' },
  templateChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emptyCard: { alignItems: 'center', borderRadius: 20, padding: 32, marginTop: 8 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 14, marginBottom: 6 },
  sectionIconCircle: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: 13, fontWeight: '800', flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, padding: 12, marginBottom: 4 },
  label: { fontSize: 15, flex: 1 },
  addSection: { gap: 8, marginTop: 4 },
  editingLabel: { fontSize: 13, fontWeight: '800' },
  categoryPickerRow: { flexDirection: 'row', gap: 8 },
  categoryChip: { flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  addRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, borderWidth: 1, borderRadius: 12, padding: 14 },
  addButton: { width: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
});
