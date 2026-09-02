import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useHabitsStore } from '@/store/useHabitsStore';
import { HabitDirection } from '@/types/life';

const DIRECTIONS: HabitDirection[] = ['build', 'quit'];

export default function NewHabitScreen() {
  const { t } = useTranslation();
  const addHabit = useHabitsStore((s) => s.addHabit);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');

  const [title, setTitle] = useState('');
  const [direction, setDirection] = useState<HabitDirection>('build');
  const [target, setTarget] = useState('');
  const [showTarget, setShowTarget] = useState(false);

  const canSave = title.trim().length > 0;

  const save = () => {
    addHabit({
      title: title.trim(),
      direction,
      targetPerWeek: showTarget && target.trim().length > 0 && !isNaN(parseInt(target)) ? parseInt(target) : undefined,
    });
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('habits.titlePlaceholder')}
          placeholderTextColor={borderColor}
          value={title}
          onChangeText={setTitle}
        />

        <Text style={sharedStyles.fieldLabel}>{t('habits.directionLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {DIRECTIONS.map((d) => (
            <Chip key={d} label={t(`habits.direction.${d}`)} active={direction === d} onPress={() => setDirection(d)} />
          ))}
        </View>

        {showTarget ? (
          <TextInput
            style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
            placeholder={t('habits.targetLabel')}
            placeholderTextColor={borderColor}
            keyboardType="number-pad"
            value={target}
            onChangeText={setTarget}
          />
        ) : (
          <Pressable onPress={() => setShowTarget(true)}>
            <Text style={[styles.addLink, { color: textMuted }]}>+ {t('habits.targetLabel')}</Text>
          </Pressable>
        )}
      </Card>

      <Button label={t('habits.save')} disabled={!canSave} onPress={save} />
    </View>
  );
}

const styles = {
  addLink: { fontSize: 13 },
};