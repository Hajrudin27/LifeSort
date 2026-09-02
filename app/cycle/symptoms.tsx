import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, FlatList, Modal, Pressable, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';
import { FlowIntensity, Symptom, SymptomLog } from '@/types/cycle';

const SYMPTOMS: Symptom[] = [
  'cramps', 'headache', 'bloating', 'fatigue', 'moodSwings', 'acne', 'backache', 'nausea', 'tenderBreasts', 'other',
];
const FLOWS: FlowIntensity[] = ['spotting', 'light', 'medium', 'heavy'];

export default function SymptomHistoryScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const textMuted = useThemeColor({}, 'textMuted');
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const symptomLogs = useCycleStore((s) => s.symptomLogs);
  const removeSymptomLog = useCycleStore((s) => s.removeSymptomLog);
  const logSymptoms = useCycleStore((s) => s.logSymptoms);

  const sorted = [...symptomLogs].sort((a, b) => b.date.localeCompare(a.date));

  const [editTarget, setEditTarget] = useState<SymptomLog | null>(null);
  const [editSymptoms, setEditSymptoms] = useState<Symptom[]>([]);
  const [editFlow, setEditFlow] = useState<FlowIntensity | undefined>(undefined);
  const [editNotes, setEditNotes] = useState('');

  const openEdit = (log: SymptomLog) => {
    setEditTarget(log);
    setEditSymptoms(log.symptoms);
    setEditFlow(log.flow);
    setEditNotes(log.notes ?? '');
  };

  const toggleEditSymptom = (s: Symptom) => {
    setEditSymptoms((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]));
  };

  const saveEdit = () => {
    if (!editTarget) return;
    logSymptoms(editTarget.date, editSymptoms, editFlow, editNotes.trim() || undefined);
    setEditTarget(null);
  };

  const confirmRemove = (id: string) => {
    Alert.alert(t('cycle.symptomLogDeleteConfirmTitle'), t('cycle.symptomLogDeleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('cycle.delete'), style: 'destructive', onPress: () => removeSymptomLog(id) },
    ]);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={[sharedStyles.emptyCard, { backgroundColor: cycleTints.accentSoft }]}>
            <Text style={{ color: textMuted }}>{t('cycle.noSymptomLogs')}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => openEdit(item)} onLongPress={() => confirmRemove(item.id)}>
            <Card style={[styles.card, { borderColor: cycleTints.accentSoft }]}>
              <View style={styles.rowHeader}>
                <View style={[styles.iconCircle, { backgroundColor: cycleTints.accent }]}>
                  <SymbolView name={{ ios: 'calendar', android: 'event', web: 'event' }} size={13} tintColor="#FFFFFF" />
                </View>
                <Text style={styles.date}>{item.date}</Text>
                {item.flow && (
                  <View style={[styles.flowBadge, { backgroundColor: cycleTints.accentSoft }]}>
                    <Text style={[styles.flowBadgeText, { color: cycleTints.accent }]}>{t(`cycle.flow.${item.flow}`)}</Text>
                  </View>
                )}
              </View>
              {item.symptoms.length > 0 && (
                <Text style={{ color: textMuted, fontSize: 13, marginTop: 4 }}>
                  {item.symptoms.map((s) => t(`cycle.symptoms.${s}`)).join(', ')}
                </Text>
              )}
              {item.notes && <Text style={{ color: textMuted, fontSize: 13, fontStyle: 'italic', marginTop: 2 }}>{item.notes}</Text>}
            </Card>
          </Pressable>
        )}
      />

      <Modal visible={editTarget !== null} animationType="slide" transparent onRequestClose={() => setEditTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setEditTarget(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor, borderColor: cycleTints.accentSoft }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView>
              <Text style={styles.modalTitle}>{editTarget?.date}</Text>

              <Text style={[sharedStyles.fieldLabel, { marginTop: 12 }]}>{t('cycle.flowLabel')}</Text>
              <View style={sharedStyles.chipRow}>
                {FLOWS.map((f) => (
                  <Chip
                    key={f}
                    label={t(`cycle.flow.${f}`)}
                    active={editFlow === f}
                    onPress={() => setEditFlow(editFlow === f ? undefined : f)}
                  />
                ))}
              </View>

              <Text style={sharedStyles.fieldLabel}>{t('cycle.symptomsTodayLabel')}</Text>
              <View style={sharedStyles.chipRow}>
                {SYMPTOMS.map((s) => (
                  <Chip
                    key={s}
                    label={t(`cycle.symptoms.${s}`)}
                    active={editSymptoms.includes(s)}
                    onPress={() => toggleEditSymptom(s)}
                  />
                ))}
              </View>

              <Text style={sharedStyles.fieldLabel}>{t('cycle.notesLabel')}</Text>
              <TextInput
                style={[sharedStyles.input, styles.notesInput, { borderColor, backgroundColor: surface }]}
                placeholder={t('cycle.notesPlaceholder')}
                placeholderTextColor={borderColor}
                value={editNotes}
                onChangeText={setEditNotes}
                multiline
              />

              <Button label={t('cycle.save')} onPress={saveEdit} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = {
  card: { borderWidth: 1.5 },
  rowHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  iconCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center' as const, justifyContent: 'center' as const },
  date: { fontWeight: '800' as const, flex: 1 },
  flowBadge: { borderRadius: 10, paddingVertical: 3, paddingHorizontal: 8 },
  flowBadgeText: { fontSize: 11, fontWeight: '700' as const },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { maxHeight: '85%' as const, borderTopWidth: 1.5, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 8 },
  modalTitle: { fontWeight: '800' as const, fontSize: 16, textAlign: 'center' as const },
  notesInput: { minHeight: 60, textAlignVertical: 'top' as const },
};