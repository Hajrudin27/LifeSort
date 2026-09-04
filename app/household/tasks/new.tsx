import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { TextInput } from 'react-native';

import AssigneeSelector from '@/components/AssigneeSelector';
import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHouseholdStore } from '@/store/useHouseholdStore';
import { TaskAssignee, TaskFrequency, TaskKind } from '@/types/household';

const FREQUENCIES: TaskFrequency[] = ['weekly', 'monthly', 'quarterly', 'yearly'];

export default function NewHouseholdTaskScreen() {
  const { t } = useTranslation();
  const { kind } = useLocalSearchParams<{ kind: TaskKind }>();
  const addTask = useHouseholdStore((s) => s.addTask);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');

  const [title, setTitle] = useState('');
  const [frequency, setFrequency] = useState<TaskFrequency>('monthly');
  const [assignedTo, setAssignedTo] = useState<TaskAssignee>('me');
  const [rotates, setRotates] = useState(false);

  const canSave = title.trim().length > 0;

  const save = () => {
    addTask({ kind, title: title.trim(), frequency, assignedTo, rotates });
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('household.titlePlaceholder')}
          placeholderTextColor={borderColor}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={sharedStyles.fieldLabel}>{t('household.frequencyLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {FREQUENCIES.map((f) => (
            <Chip key={f} label={t(`household.frequency.${f}`)} active={frequency === f} onPress={() => setFrequency(f)} />
          ))}
        </View>
      </Card>

      <Card style={sharedStyles.card}>
        <AssigneeSelector
          assignedTo={assignedTo}
          onChangeAssignee={setAssignedTo}
          rotates={rotates}
          onChangeRotates={setRotates}
        />
      </Card>

      <Button label={t('household.save')} disabled={!canSave} onPress={save} />
    </View>
  );
}