import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import AttachmentList from '@/components/AttachmentList';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useToastStore } from '@/store/useToastStore';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { WarrantyType } from '@/types/warranty';
import { getWarrantyTypeIconName } from '@/utils/warranty/warrantyTypeIcon';

const TYPES: WarrantyType[] = ['warranty', 'receipt', 'insurance', 'rental', 'other'];
const BRAND_INK = '#16130F';
const BRAND_ROSE = '#E11D48';
const BRAND_AMBER = '#F59E0B';

const pad = (value: number) => value.toString().padStart(2, '0');

function toISODate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function addYears(years: number) {
  const date = new Date();
  date.setFullYear(date.getFullYear() + years);
  return toISODate(date);
}

export default function NewWarrantyScreen() {
  const { t } = useTranslation();
  const addWarranty = useWarrantiesStore((s) => s.addWarranty);
  const allWarranties = useWarrantiesStore((s) => s.warranties);
  const addAttachment = useWarrantiesStore((s) => s.addAttachment);
  const removeAttachment = useWarrantiesStore((s) => s.removeAttachment);
  const showToast = useToastStore((s) => s.show);
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');

  const defaultExpiry = useMemo(() => addYears(2), []);
  const [name, setName] = useState('');
  const [type, setType] = useState<WarrantyType>('warranty');
  const [expiryDate, setExpiryDate] = useState(defaultExpiry);
  const [expiryMode, setExpiryMode] = useState<'month' | 'year' | 'twoYears' | 'custom'>('twoYears');
  const [notes, setNotes] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canSave = name.trim().length > 0;
  const createdWarranty = allWarranties.find((w) => w.id === createdId);
  const expiryShortcuts = [
    { key: 'month', label: t('warranties.expiryMonth'), value: addDays(30) },
    { key: 'year', label: t('warranties.expiryYear'), value: addYears(1) },
    { key: 'twoYears', label: t('warranties.expiryTwoYears'), value: addYears(2) },
  ] as const;

  const selectExpiryShortcut = (mode: (typeof expiryShortcuts)[number]['key']) => {
    setExpiryMode(mode);
    setExpiryDate(expiryShortcuts.find((item) => item.key === mode)?.value ?? defaultExpiry);
  };

  const openCustomDate = () => {
    setExpiryMode('custom');
    setExpiryDate((current) => current || defaultExpiry);
  };

  const save = () => {
    if (!canSave) return;
    const id = addWarranty({ name: name.trim(), type, expiryDate, notes: notes.trim() || undefined });
    showToast(t('warranties.createdToast'));
    setCreatedId(id);
  };

  const finish = () => {
    setCreatedId(null);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.container}
      >
        <Card style={[styles.hero, { backgroundColor: BRAND_INK, overflow: 'hidden' }]}>
          <View style={[styles.heroRoseGlow, { backgroundColor: BRAND_ROSE }]} />
          <View style={[styles.heroAmberGlow, { backgroundColor: BRAND_AMBER }]} />
          <View style={styles.heroTopRow}>
            <View style={styles.heroIcon}>
              <SymbolView name={{ ios: 'shield.lefthalf.filled', android: 'shield', web: 'shield' }} size={24} tintColor="#FFFFFF" />
            </View>
            <View style={styles.heroBadge}>
              <SymbolView name={{ ios: 'bell.badge.fill', android: 'notifications', web: 'notifications' }} size={14} tintColor="#FFFFFF" />
              <Text style={styles.heroBadgeText}>{t('warranties.reminderBadge')}</Text>
            </View>
          </View>
          <Text style={styles.heroKicker}>{t('warranties.quickKicker')}</Text>
          <Text style={styles.heroTitle}>{t('warranties.quickTitle')}</Text>
          <Text style={styles.heroSubtitle}>{t('warranties.quickSubtitle')}</Text>
        </Card>

        <View style={styles.formSection}>
          <Text style={styles.sectionEyebrow}>{t('warranties.nameLabel')}</Text>
          <TextInput
            style={[styles.nameInput, { borderColor, backgroundColor: surface }]}
            placeholder={t('warranties.namePlaceholder')}
            placeholderTextColor={textMuted}
            value={name}
            onChangeText={setName}
          />

          <Text style={styles.sectionEyebrow}>{t('warranties.notesLabel')}</Text>
          <TextInput
            style={[styles.notesInput, { borderColor, backgroundColor: surface }]}
            placeholder={t('warranties.notesPlaceholder')}
            placeholderTextColor={textMuted}
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>

        <View style={styles.optionSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('warranties.typeLabel')}</Text>
            <Text style={[styles.sectionMeta, { color: textMuted }]}>{t(`warranties.types.${type}`)}</Text>
          </View>

          <View style={styles.typeGrid}>
            {TYPES.map((item) => {
              const active = type === item;
              return (
                <Pressable
                  key={item}
                  style={[
                    styles.typeCard,
                    {
                      backgroundColor: active ? accentTints.accent : surface,
                      borderColor: active ? accentTints.accent : borderColor,
                    },
                  ]}
                  onPress={() => setType(item)}
                >
                  <SymbolView
                    name={getWarrantyTypeIconName(item) as any}
                    size={18}
                    tintColor={active ? '#FFFFFF' : accentTints.accent}
                  />
                  <Text style={[styles.typeLabel, { color: active ? '#FFFFFF' : undefined }]} numberOfLines={1}>
                    {t(`warranties.types.${item}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.optionSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('warranties.expiryLabel')}</Text>
            <Pressable style={[styles.customDateButton, { backgroundColor: surfaceMuted }]} onPress={openCustomDate}>
              <SymbolView name={{ ios: 'calendar', android: 'event', web: 'event' }} size={14} tintColor={accentTints.accent} />
              <Text style={[styles.customDateText, { color: accentTints.accent }]}>{t('warranties.customDate')}</Text>
            </Pressable>
          </View>

          <View style={styles.expiryChips}>
            {expiryShortcuts.map((shortcut) => (
              <Pressable
                key={shortcut.key}
                style={[
                  styles.expiryChip,
                  {
                    backgroundColor: expiryMode === shortcut.key ? accentTints.accent : surface,
                    borderColor: expiryMode === shortcut.key ? accentTints.accent : borderColor,
                  },
                ]}
                onPress={() => selectExpiryShortcut(shortcut.key)}
              >
                <Text style={[styles.expiryChipText, { color: expiryMode === shortcut.key ? '#FFFFFF' : undefined }]}>
                  {shortcut.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {expiryMode === 'custom' && (
            <DatePickerField value={expiryDate} onChange={setExpiryDate} yearsBack={0} yearsForward={15} />
          )}
        </View>

        <View style={[styles.reminderCard, { backgroundColor: surface, borderColor }]}>
          <View style={[styles.reminderIcon, { backgroundColor: surfaceMuted }]}>
            <SymbolView name={{ ios: 'bell.fill', android: 'notifications', web: 'notifications' }} size={17} tintColor={accentTints.accent} />
          </View>
          <View style={styles.reminderTextGroup}>
            <Text style={styles.reminderTitle}>{t('warranties.reminderTitlePreview')}</Text>
            <Text style={[styles.reminderSubtitle, { color: textMuted }]}>{t('warranties.reminderSubtitle')}</Text>
          </View>
        </View>

        <Button label={t('warranties.save')} disabled={!canSave} onPress={save} style={styles.saveButton} />
      </ScrollView>

      <Modal visible={createdId !== null} animationType="slide" transparent onRequestClose={finish}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor, borderColor }]}>
            <View style={styles.modalHandle} />
            <View style={styles.modalHeader}>
              <View style={[styles.modalIcon, { backgroundColor: accentTints.accentSoft }]}>
                <SymbolView name={{ ios: 'paperclip', android: 'attach_file', web: 'attach_file' }} size={20} tintColor={accentTints.accent} />
              </View>
              <View style={styles.modalTitleGroup}>
                <Text style={styles.modalTitle}>{t('warranties.attachmentTitle')}</Text>
                <Text style={[styles.modalSubtitle, { color: textMuted }]}>{t('warranties.attachmentSubtitle')}</Text>
              </View>
            </View>

            {createdWarranty && (
              <AttachmentList
                attachments={createdWarranty.attachments ?? []}
                onAdd={(a) => addAttachment(createdWarranty.id, a)}
                onRemove={(attachmentId) => removeAttachment(createdWarranty.id, attachmentId)}
              />
            )}
            <Button label={t('warranties.done')} onPress={finish} />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { padding: 16, gap: 16, paddingBottom: 44 },
  hero: { borderRadius: 24, gap: 8, padding: 20, position: 'relative' },
  heroRoseGlow: { position: 'absolute', width: 190, height: 190, borderRadius: 95, top: -86, right: -58, opacity: 0.25 },
  heroAmberGlow: { position: 'absolute', width: 130, height: 130, borderRadius: 65, bottom: -48, left: -34, opacity: 0.18 },
  heroTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: 'transparent' },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroBadge: {
    minHeight: 30,
    borderRadius: 15,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  heroBadgeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800', backgroundColor: 'transparent' },
  heroKicker: {
    color: '#FFE4EA',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    backgroundColor: 'transparent',
  },
  heroTitle: { color: '#FFFFFF', fontSize: 27, fontWeight: '800', backgroundColor: 'transparent' },
  heroSubtitle: { color: '#FFFFFF', fontSize: 14, lineHeight: 20, opacity: 0.85, backgroundColor: 'transparent' },
  formSection: { gap: 9 },
  sectionEyebrow: { fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', opacity: 0.62 },
  nameInput: {
    borderWidth: 1.5,
    borderRadius: 18,
    fontSize: 20,
    fontWeight: '800',
    paddingHorizontal: 16,
    paddingVertical: 15,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 18,
    fontSize: 15,
    minHeight: 92,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    textAlignVertical: 'top',
  },
  optionSection: { gap: 12 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { fontSize: 17, fontWeight: '800' },
  sectionMeta: { flex: 1, textAlign: 'right', fontSize: 12, fontWeight: '700' },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  typeCard: {
    width: '30.6%',
    minHeight: 76,
    borderWidth: 1.5,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  typeLabel: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  customDateButton: {
    minHeight: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  customDateText: { fontSize: 12, fontWeight: '800' },
  expiryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  expiryChip: { borderWidth: 1.5, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10 },
  expiryChipText: { fontSize: 13, fontWeight: '800' },
  reminderCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  reminderIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  reminderTextGroup: { flex: 1, gap: 2 },
  reminderTitle: { fontSize: 15, fontWeight: '800' },
  reminderSubtitle: { fontSize: 12, lineHeight: 17 },
  saveButton: { marginTop: 2 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalCard: {
    borderTopWidth: 1,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: 16,
    paddingBottom: 32,
    gap: 14,
  },
  modalHandle: {
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(120,110,100,0.28)',
    alignSelf: 'center',
    marginBottom: 2,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  modalIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  modalTitleGroup: { flex: 1, gap: 2 },
  modalTitle: { fontSize: 18, fontWeight: '800' },
  modalSubtitle: { fontSize: 13, lineHeight: 18 },
});
