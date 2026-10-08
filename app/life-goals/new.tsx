import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import DatePickerField from '@/components/DatePickerField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { GOAL_TYPES } from '@/features/goals/domain/goal';
import { EMPTY_VALUE_TEXT, validateGoalForm, type GoalFormErrorKey, type GoalFormState } from '@/features/goals/domain/goalInput';
import GoalValueFields from '@/features/goals/GoalValueFields';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { todayIso } from '@/utils/shared/localDate';

export default function NewLifeGoalScreen() {
  const { t } = useTranslation();
  const addGoal = useLifeGoalsStore((s) => s.addGoal);
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const textMuted = useThemeColor({}, 'textMuted');
  const backgroundColor = useThemeColor({}, 'background');
  const danger = useThemeColor({}, 'danger');

  const [form, setForm] = useState<GoalFormState>({
    type: 'binary', title: '', description: '', deadline: null,
    target: EMPTY_VALUE_TEXT, current: EMPTY_VALUE_TEXT, unit: '',
  });
  const [errors, setErrors] = useState<Partial<Record<'title' | 'target' | 'current' | 'unit', GoalFormErrorKey>>>({});
  const patch = (changes: Partial<GoalFormState>) => setForm((previous) => ({ ...previous, ...changes }));
  const message = (key?: GoalFormErrorKey) => (key ? t(`lifeGoals.errors.${key}`) : undefined);

  const save = () => {
    const result = validateGoalForm(form);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    router.replace(`/life-goals/${addGoal(result.input)}`);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t('lifeGoals.new.typeLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {GOAL_TYPES.map((type) => (
            <Chip
              key={type}
              label={t(`lifeGoals.new.types.${type}`)}
              active={form.type === type}
              onPress={() => { patch({ type }); setErrors({}); }}
            />
          ))}
        </View>
        <Text style={{ color: textMuted, fontSize: 13 }}>{t(`lifeGoals.new.typeHelp.${form.type}`)}</Text>
      </Card>

      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor: errors.title ? danger : borderColor, backgroundColor: surface }]}
          placeholder={t('lifeGoals.titlePlaceholder')}
          placeholderTextColor={borderColor}
          accessibilityLabel={t('lifeGoals.titlePlaceholder')}
          value={form.title}
          onChangeText={(title) => patch({ title })}
        />
        {errors.title ? <Text accessibilityRole="alert" style={{ color: danger, fontSize: 13 }}>{message(errors.title)}</Text> : null}
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('lifeGoals.descriptionPlaceholder')}
          placeholderTextColor={borderColor}
          accessibilityLabel={t('lifeGoals.descriptionPlaceholder')}
          value={form.description}
          onChangeText={(description) => patch({ description })}
        />

        {form.type !== 'binary' ? (
          <>
            {form.type === 'amount' ? (
              <>
                <Text style={sharedStyles.fieldLabel}>{t('lifeGoals.new.unitLabel')}</Text>
                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface, minHeight: 44 }]}
                  placeholder={t('lifeGoals.new.unitPlaceholder')}
                  placeholderTextColor={borderColor}
                  accessibilityLabel={t('lifeGoals.new.unitLabel')}
                  value={form.unit}
                  maxLength={24}
                  onChangeText={(unit) => patch({ unit })}
                />
                {errors.unit ? <Text accessibilityRole="alert" style={{ color: danger, fontSize: 13 }}>{message(errors.unit)}</Text> : null}
                <Text style={{ color: textMuted, fontSize: 13 }}>{t('lifeGoals.new.amountHint')}</Text>
              </>
            ) : null}
            <GoalValueFields
              type={form.type}
              label={t('lifeGoals.new.targetLabel')}
              value={form.target}
              onChange={(target) => patch({ target })}
              error={message(errors.target)}
              unit={form.unit.trim()}
            />
            <GoalValueFields
              type={form.type}
              label={t('lifeGoals.new.currentLabel')}
              value={form.current}
              onChange={(current) => patch({ current })}
              error={message(errors.current)}
              unit={form.unit.trim()}
            />
          </>
        ) : null}

        {form.deadline !== null ? (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('lifeGoals.deadlineLabel')}</Text>
            <DatePickerField value={form.deadline} onChange={(deadline) => patch({ deadline })} />
            <Pressable accessibilityRole="button" style={styles.linkButton} onPress={() => patch({ deadline: null })}>
              <Text style={{ color: textMuted }}>{t('lifeGoals.removeDeadline')}</Text>
            </Pressable>
          </>
        ) : (
          // Adding a deadline selects the date the picker shows, so what is seen is what is saved.
          <Pressable accessibilityRole="button" style={styles.linkButton} onPress={() => patch({ deadline: todayIso() })}>
            <Text style={{ color: textMuted }}>+ {t('lifeGoals.deadlineLabel')}</Text>
          </Pressable>
        )}
      </Card>

      <Button label={t('lifeGoals.save')} onPress={save} />
    </ScrollView>
  );
}

const styles = {
  linkButton: { minHeight: 44, justifyContent: 'center' as const },
};
