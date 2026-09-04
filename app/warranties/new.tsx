import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, TextInput } from 'react-native';

import AttachmentList from '@/components/AttachmentList';
import Button from '@/components/Button';
import Card from '@/components/Card';
import DatePickerField from '@/components/DatePickerField';
import SelectField from '@/components/SelectField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useWarrantiesStore } from '@/store/useWarrantiesStore';
import { WarrantyType } from '@/types/warranty';

const TYPES: WarrantyType[] = ['insurance', 'rental', 'warranty', 'receipt', 'other'];

export default function NewWarrantyScreen() {
  const { t } = useTranslation();
  const addWarranty = useWarrantiesStore((s) => s.addWarranty);
  const allWarranties = useWarrantiesStore((s) => s.warranties);
  const addAttachment = useWarrantiesStore((s) => s.addAttachment);
  const removeAttachment = useWarrantiesStore((s) => s.removeAttachment);
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const [name, setName] = useState('');
  const [type, setType] = useState<WarrantyType>('warranty');
  const todayIso = new Date().toISOString().split('T')[0];
  const [expiryDate, setExpiryDate] = useState(todayIso);
  const [notes, setNotes] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  const canSave = name.trim().length > 0;

  const save = () => {
    const id = addWarranty({ name: name.trim(), type, expiryDate, notes: notes.trim() || undefined });
    setCreatedId(id);
  };

  const finish = () => {
    setCreatedId(null);
    router.back();
  };

  const createdWarranty = allWarranties.find((w) => w.id === createdId);

  return (
    <View style={sharedStyles.formContainer}>
      <View style={[styles.kicker, { backgroundColor: accentTints.accentSoft }]}>
        <SymbolView name={{ ios: 'shield.lefthalf.filled', android: 'shield', web: 'shield' }} size={12} tintColor={accentTints.accent} />
        <Text style={[styles.kickerText, { color: accentTints.accent }]}>{t('warranties.newScreenTitle')}</Text>
      </View>

      <Card style={[sharedStyles.card, styles.formCard, { borderColor: accentTints.accentSoft }]}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('warranties.namePlaceholder')}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />

        <SelectField
          options={TYPES.map((ty) => ({ id: ty, label: t(`warranties.types.${ty}`) }))}
          selected={type}
          onSelect={(id) => setType(id as WarrantyType)}
          placeholder={t('warranties.typeLabel')}
          modalTitle={t('warranties.typeLabel')}
        />

        <Text style={sharedStyles.fieldLabel}>{t('warranties.expiryLabel')}</Text>
        <DatePickerField value={expiryDate} onChange={setExpiryDate} />

        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('warranties.notesPlaceholder')}
          placeholderTextColor={borderColor}
          value={notes}
          onChangeText={setNotes}
        />
      </Card>

      <Button label={t('warranties.save')} disabled={!canSave} onPress={save} />

      <Modal visible={createdId !== null} animationType="slide" transparent onRequestClose={finish}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor, borderColor }]}>
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
    </View>
  );
}

const styles = {
  kicker: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, alignSelf: 'flex-start' as const, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, marginBottom: 4 },
  kickerText: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  formCard: { borderWidth: 1.5 },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalCard: {
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
};