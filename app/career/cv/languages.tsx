import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Modal, Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCVStore } from '@/store/useCVStore';
import { useToastStore } from '@/store/useToastStore';
import { LanguageEntry, LanguageProficiency } from '@/types/cv';

const LEVELS: LanguageProficiency[] = ['basic', 'conversational', 'fluent', 'native'];

export default function LanguagesScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const languages = useCVStore((s) => s.languages);
  const addLanguage = useCVStore((s) => s.addLanguage);
  const updateLanguage = useCVStore((s) => s.updateLanguage);
  const removeLanguage = useCVStore((s) => s.removeLanguage);
  const showToast = useToastStore((s) => s.show);

  const [name, setName] = useState('');
  const [proficiency, setProficiency] = useState<LanguageProficiency>('conversational');

  const [editTarget, setEditTarget] = useState<LanguageEntry | null>(null);
  const [editName, setEditName] = useState('');
  const [editProficiency, setEditProficiency] = useState<LanguageProficiency>('conversational');

  const canAdd = name.trim().length > 0;

  const add = () => {
    addLanguage(name.trim(), proficiency);
    showToast(t('common.saved'));
    setName('');
  };

  const handleLongPress = (lang: LanguageEntry) => {
    Alert.alert(lang.name, undefined, [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('cv.edit'), onPress: () => { setEditTarget(lang); setEditName(lang.name); setEditProficiency(lang.proficiency); } },
      { text: t('cv.delete'), style: 'destructive', onPress: () => removeLanguage(lang.id) },
    ]);
  };

  const confirmEdit = () => {
    if (!editTarget || editName.trim().length === 0) return;
    updateLanguage(editTarget.id, { name: editName.trim(), proficiency: editProficiency });
    setEditTarget(null);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={languages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('cv.emptyLanguages')}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onLongPress={() => handleLongPress(item)}>
            <Card style={sharedStyles.rowBetween}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={{ color: textMuted }}>{t(`cv.proficiency.${item.proficiency}`)}</Text>
            </Card>
          </Pressable>
        )}
      />

      <Card style={sharedStyles.card}>
        <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} placeholder={t('cv.languageNamePlaceholder')} placeholderTextColor={borderColor} value={name} onChangeText={setName} />
        <View style={sharedStyles.chipRow}>
          {LEVELS.map((l) => (
            <Chip key={l} label={t(`cv.proficiency.${l}`)} active={proficiency === l} onPress={() => setProficiency(l)} />
          ))}
        </View>
        <Button label={t('cv.add')} disabled={!canAdd} onPress={add} />
      </Card>

      <Modal visible={editTarget !== null} animationType="fade" transparent onRequestClose={() => setEditTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor, borderColor }]}>
            <TextInput style={[sharedStyles.input, { borderColor, backgroundColor: surface }]} value={editName} onChangeText={setEditName} />
            <View style={sharedStyles.chipRow}>
              {LEVELS.map((l) => (
                <Chip key={l} label={t(`cv.proficiency.${l}`)} active={editProficiency === l} onPress={() => setEditProficiency(l)} />
              ))}
            </View>
            <Button label={t('cv.confirm')} onPress={confirmEdit} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = {
  name: { fontWeight: '700' as const },
  modalBackdrop: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { width: '85%' as const, borderWidth: 1, borderRadius: 20, padding: 18, gap: 12 },
};