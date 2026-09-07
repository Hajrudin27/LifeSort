import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { todayIso } from '@/utils/shared/localDate';

export default function NewLifeGoalScreen() {
  const { t } = useTranslation();
  const addGoal = useLifeGoalsStore((s) => s.addGoal);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [showDeadlinePicker, setShowDeadlinePicker] = useState(false);

  const canSave = title.trim().length > 0;

  const save = () => {
    const id = addGoal({
      title: title.trim(),
      description: description.trim() || undefined,
      deadline: showDeadlinePicker && deadline ? deadline : undefined,
    });
    router.replace(`/life-goals/${id}`);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('lifeGoals.titlePlaceholder')}
          placeholderTextColor={borderColor}
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('lifeGoals.descriptionPlaceholder')}
          placeholderTextColor={borderColor}
          value={description}
          onChangeText={setDescription}
        />

        {showDeadlinePicker ? (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('lifeGoals.deadlineLabel')}</Text>
            <DatePickerField value={deadline || todayIso()} onChange={setDeadline} />
          </>
        ) : (
          <Pressable accessibilityRole="button" onPress={() => setShowDeadlinePicker(true)}>
            <Text style={[styles.addLink, { color: textMuted }]}>+ {t('lifeGoals.deadlineLabel')}</Text>
          </Pressable>
        )}
      </Card>

      <Button label={t('lifeGoals.save')} disabled={!canSave} onPress={save} />
    </View>
  );
}

const styles = {
  addLink: { fontSize: 13 },
};