import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import {
  availableMovingUpgrade,
  getMovingTemplate,
  groupMovingItems,
  latestSelectableMovingTemplate,
  movingReviewStatus,
} from '@/features/home/movingTemplates';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { useToastStore } from '@/store/useToastStore';
import type { MovingItem } from '@/types/household';
import { todayIso } from '@/utils/shared/localDate';

type Row =
  | { kind: 'header'; id: string; titleKey: string }
  | { kind: 'item'; id: string; item: MovingItem };

export default function MovingChecklistScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const tintColor = useThemeColor({}, 'tint');
  const textMuted = useThemeColor({}, 'textMuted');
  const warning = useThemeColor({}, 'warning');

  const items = useHouseholdStore((s) => s.movingItems);
  const marker = useHouseholdStore((s) => s.movingTemplate);
  const addMovingItem = useHouseholdStore((s) => s.addMovingItem);
  const toggleMovingItem = useHouseholdStore((s) => s.toggleMovingItem);
  const removeMovingItem = useHouseholdStore((s) => s.removeMovingItem);
  const startMovingFromTemplate = useHouseholdStore((s) => s.startMovingFromTemplate);
  const acceptMovingTemplateUpgrade = useHouseholdStore((s) => s.acceptMovingTemplateUpgrade);
  const showToast = useToastStore((s) => s.show);

  const [newLabel, setNewLabel] = useState('');

  const rows = useMemo<Row[]>(() => groupMovingItems(items).flatMap((group) => [
    { kind: 'header' as const, id: `header-${group.id}`, titleKey: group.titleKey },
    ...group.items.map((item) => ({ kind: 'item' as const, id: item.id, item })),
  ]), [items]);

  // The card describes the version the user holds; before any start, the one that would be copied.
  const template = (marker && getMovingTemplate(marker.id, marker.version)) || latestSelectableMovingTemplate();
  const upgrade = useMemo(() => availableMovingUpgrade(marker, items), [marker, items]);
  const canStart = !!template && (marker === null || items.length === 0);

  const addItem = () => {
    if (newLabel.trim().length === 0) return;
    addMovingItem(newLabel.trim());
    showToast(t('common.saved'));
    setNewLabel('');
  };

  const start = () => {
    if (startMovingFromTemplate() > 0) showToast(t('common.saved'));
  };
  const accept = () => {
    if (acceptMovingTemplateUpgrade() > 0) showToast(t('common.saved'));
  };

  const header = template ? (
    <View>
      <Card style={styles.infoCard}>
        <Text accessibilityRole="header" style={styles.infoTitle}>
          {t(`household.moving.templates.${template.titleKey}`)}
        </Text>
        <Text style={[styles.infoLine, { color: textMuted }]}>
          {t('household.moving.templateCard.version', { version: template.version })}
        </Text>
        <Text style={[styles.infoLine, { color: textMuted }]}>
          {t('household.moving.templateCard.source', { source: t(`household.moving.authority.${template.metadata.source}`) })}
        </Text>
        <Text style={[styles.infoLine, { color: textMuted }]}>
          {t('household.moving.templateCard.reviewed', {
            date: template.metadata.reviewedAt,
            reviewer: t(`household.moving.authority.${template.metadata.reviewedBy}`),
          })}
        </Text>
        {movingReviewStatus(template.metadata, todayIso()) === 'current' ? (
          <Text style={[styles.infoLine, { color: textMuted }]}>
            {t('household.moving.templateCard.reviewCurrent', { date: template.metadata.reviewDueAt })}
          </Text>
        ) : (
          <Text style={[styles.infoLine, { color: warning }]}>
            {t('household.moving.templateCard.reviewDue', { date: template.metadata.reviewDueAt })}
          </Text>
        )}
        <Text style={[styles.infoLine, { color: textMuted }]}>{t('household.moving.templateCard.disclaimer')}</Text>
      </Card>
      {canStart ? (
        <Button
          style={styles.action}
          label={marker === null ? t('household.moving.addSuggestions') : t('household.moving.startAgain')}
          onPress={start}
        />
      ) : null}
      {upgrade ? (
        <Button
          variant="secondary"
          style={styles.action}
          label={t('household.moving.newSuggestions', { count: upgrade.newItems.length })}
          onPress={accept}
        />
      ) : null}
    </View>
  ) : null;

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={sharedStyles.list}
        ListHeaderComponent={header}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('household.moving.emptyHint')}</Text>
          </Card>
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: textMuted }]}>
                {t(`household.moving.sections.${row.titleKey}`)}
              </Text>
            );
          }
          const item = row.item;
          return (
            <Card style={sharedStyles.rowBetween}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.checked }}
                style={styles.checkRow}
                onPress={() => toggleMovingItem(item.id)}>
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
                accessibilityLabel={t('household.a11y.removeMovingItem', { item: item.label })}
                hitSlop={14}
                style={styles.removeButton}
                onPress={() => removeMovingItem(item.id)}>
                <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={borderColor} />
              </Pressable>
            </Card>
          );
        }}
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
        <Pressable accessibilityRole="button" style={[styles.addButton, { borderColor }]} onPress={addItem}>
          <Text style={styles.addButtonText}>{t('household.add')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = {
  checkRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, flex: 1, minHeight: 44 },
  removeButton: { minWidth: 44, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  label: { fontSize: 15, flexShrink: 1 },
  infoCard: { gap: 4, marginBottom: 12 },
  infoTitle: { fontWeight: '700' as const, fontSize: 15 },
  infoLine: { fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: '700' as const, marginTop: 8, marginBottom: 4 },
  action: { marginTop: 12, minHeight: 44 },
  addRow: { flexDirection: 'row' as const, gap: 8, marginTop: 12 },
  addInput: { flex: 1 },
  addButton: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, justifyContent: 'center' as const, minHeight: 44 },
  addButtonText: { fontWeight: '700' as const },
};
