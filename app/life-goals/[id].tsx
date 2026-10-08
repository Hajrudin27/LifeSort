import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import DatePickerField from '@/components/DatePickerField';
import RingProgress from '@/components/RingProgress';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { goalIsCompleted, goalMilestoneSummary, goalProgress, isGoalUnit } from '@/features/goals/domain/goal';
import {
  parseCurrent,
  parseTarget,
  valueTextFrom,
  type GoalFormErrorKey,
  type GoalValueText,
  EMPTY_VALUE_TEXT,
} from '@/features/goals/domain/goalInput';
import { decimalSeparator, goalValueText } from '@/features/goals/goalDisplay';
import GoalValueFields from '@/features/goals/GoalValueFields';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useLifeGoalsStore } from '@/store/useLifeGoalsStore';
import { todayIso } from '@/utils/shared/localDate';

export default function LifeGoalDetailScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const danger = useThemeColor({}, 'danger');
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');

  const goal = useLifeGoalsStore((s) => s.goals.find((g) => g.id === id));
  const updateGoal = useLifeGoalsStore((s) => s.updateGoal);
  const removeGoal = useLifeGoalsStore((s) => s.removeGoal);
  const setGoalCurrent = useLifeGoalsStore((s) => s.setGoalCurrent);
  const setGoalCompleted = useLifeGoalsStore((s) => s.setGoalCompleted);
  const addMilestone = useLifeGoalsStore((s) => s.addMilestone);
  const toggleMilestone = useLifeGoalsStore((s) => s.toggleMilestone);
  const removeMilestone = useLifeGoalsStore((s) => s.removeMilestone);

  const separator = decimalSeparator(i18n.language);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState<string | null>(null);
  const [targetText, setTargetText] = useState<GoalValueText>(EMPTY_VALUE_TEXT);
  const [unit, setUnit] = useState('');
  const [currentText, setCurrentText] = useState<GoalValueText | null>(null);
  const [newMilestone, setNewMilestone] = useState('');
  const [showEdit, setShowEdit] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<'title' | 'target' | 'current' | 'unit', GoalFormErrorKey>>>({});
  const message = (key?: GoalFormErrorKey) => (key ? t(`lifeGoals.errors.${key}`) : undefined);

  if (!goal) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('lifeGoals.emptyState')}</Text>
      </View>
    );
  }

  const numeric = goal.type !== 'binary' ? goal.type : null;
  const progress = goalProgress(goal);
  const completed = goalIsCompleted(goal);
  const milestones = goalMilestoneSummary(goal);

  const openEdit = () => {
    setTitle(goal.title);
    setDescription(goal.description ?? '');
    setDeadline(goal.deadline ?? null);
    if (goal.type !== 'binary') setTargetText(valueTextFrom(goal.type, goal.target, separator));
    setUnit(goal.type === 'amount' ? goal.unit : '');
    setErrors({});
    setShowEdit(true);
  };

  const save = () => {
    const found: typeof errors = {};
    if (!title.trim()) found.title = 'title';
    let target: number | undefined;
    if (numeric) {
      const parsed = parseTarget(numeric, targetText);
      if ('error' in parsed) found.target = parsed.error; else target = parsed.value;
    }
    if (goal.type === 'amount' && !isGoalUnit(unit.trim())) found.unit = 'unit';
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }
    updateGoal(goal.id, {
      title,
      description: description.trim() ? description : null,
      deadline,
      ...(target !== undefined ? { target } : {}),
      ...(goal.type === 'amount' ? { unit } : {}),
    });
    setShowEdit(false);
  };

  const saveProgress = () => {
    if (!numeric || !currentText) return;
    const parsed = parseCurrent(numeric, currentText);
    if ('error' in parsed) {
      setErrors({ current: parsed.error });
      return;
    }
    setErrors({});
    setGoalCurrent(goal.id, parsed.value);
    setCurrentText(null);
  };

  const addMilestoneFromInput = () => {
    if (newMilestone.trim().length === 0) return;
    addMilestone(goal.id, newMilestone);
    setNewMilestone('');
  };

  const confirmDelete = () => {
    Alert.alert(t('lifeGoals.deleteConfirmTitle'), t('lifeGoals.deleteConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      {
        text: t('lifeGoals.delete'),
        style: 'destructive',
        onPress: () => {
          removeGoal(goal.id);
          router.back();
        },
      },
    ]);
  };

  // The progress editor starts from the stored value and is only held while it is being changed.
  const editingProgress = numeric && currentText !== null;
  const currentFields: GoalValueText | null = numeric
    ? currentText ?? valueTextFrom(numeric, (goal as { current: number }).current, separator)
    : null;

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: goal.title,
          headerRight: () => (
            <Pressable accessibilityRole="button" onPress={openEdit} style={styles.editButton}>
              <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={20} tintColor={textMuted} />
              <Text style={{ color: textMuted }}>{t('lifeGoals.edit')}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.progressCard}>
        <RingProgress progress={progress} size={80} strokeWidth={8} />
        <Text accessibilityRole="header" style={styles.valueText}>{goalValueText(goal, t, i18n.language)}</Text>
        {numeric && completed ? <Text style={{ color: textMuted }}>{t('lifeGoals.progress.reached')}</Text> : null}
        {milestones.total > 0 ? (
          <Text style={{ color: textMuted }}>
            {t('lifeGoals.milestoneProgress', { done: milestones.done, total: milestones.total, count: milestones.total })}
          </Text>
        ) : null}
        {goal.deadline ? <Text style={{ color: textMuted }}>{t('lifeGoals.deadlineOn', { date: goal.deadline })}</Text> : null}
      </Card>

      {goal.type === 'binary' ? (
        <Button
          label={goal.completed ? t('lifeGoals.binary.reopen') : t('lifeGoals.binary.markDone')}
          variant={goal.completed ? 'secondary' : 'primary'}
          style={styles.action}
          onPress={() => setGoalCompleted(goal.id, !goal.completed)}
        />
      ) : null}

      {numeric && currentFields ? (
        <Card style={sharedStyles.card}>
          <GoalValueFields
            type={numeric}
            label={t('lifeGoals.progress.update')}
            value={currentFields}
            onChange={setCurrentText}
            error={message(errors.current)}
            unit={goal.type === 'amount' ? goal.unit : undefined}
          />
          <Button
            label={t('lifeGoals.progress.save')}
            variant="secondary"
            disabled={!editingProgress}
            style={styles.action}
            onPress={saveProgress}
          />
        </Card>
      ) : null}

      <Text accessibilityRole="header" style={sharedStyles.sectionLabel}>{t('lifeGoals.milestonesLabel')}</Text>
      {goal.milestones.length === 0 ? (
        <Text style={[sharedStyles.emptyState, { color: textMuted }]}>{t('lifeGoals.noMilestones')}</Text>
      ) : (
        <View style={sharedStyles.list}>
          {goal.milestones.map((milestone) => (
            <Card key={milestone.id} style={sharedStyles.rowBetween}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: milestone.completed }}
                accessibilityLabel={t('lifeGoals.a11y.milestone', { title: milestone.title })}
                style={styles.milestoneRow}
                onPress={() => toggleMilestone(goal.id, milestone.id)}
              >
                <SymbolView
                  name={{
                    ios: milestone.completed ? 'checkmark.circle.fill' : 'circle',
                    android: milestone.completed ? 'check_circle' : 'radio_button_unchecked',
                    web: milestone.completed ? 'check_circle' : 'radio_button_unchecked',
                  }}
                  tintColor={milestone.completed ? tintColor : borderColor}
                  size={20}
                />
                <Text style={[styles.milestoneText, milestone.completed && { color: textMuted, textDecorationLine: 'line-through' }]}>
                  {milestone.title}
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('lifeGoals.a11y.removeMilestone', { title: milestone.title })}
                style={styles.removeButton}
                onPress={() => removeMilestone(goal.id, milestone.id)}
              >
                <SymbolView name={{ ios: 'xmark', android: 'close', web: 'close' }} size={16} tintColor={borderColor} />
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={[sharedStyles.input, styles.addInput, { borderColor, backgroundColor: surface }]}
          placeholder={t('lifeGoals.newMilestonePlaceholder')}
          placeholderTextColor={borderColor}
          accessibilityLabel={t('lifeGoals.newMilestonePlaceholder')}
          value={newMilestone}
          onChangeText={setNewMilestone}
          onSubmitEditing={addMilestoneFromInput}
        />
        <Pressable accessibilityRole="button" style={[styles.addButton, { borderColor }]} onPress={addMilestoneFromInput}>
          <Text style={styles.addButtonText}>{t('lifeGoals.addMilestone')}</Text>
        </Pressable>
      </View>

      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <Pressable accessible={false} style={styles.modalBackdrop} onPress={() => setShowEdit(false)}>
          <Pressable
            accessible={false}
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(event) => event.stopPropagation()}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              <Card style={sharedStyles.card}>
                <TextInput
                  style={[sharedStyles.input, { borderColor: errors.title ? danger : borderColor, backgroundColor: surface }]}
                  value={title}
                  accessibilityLabel={t('lifeGoals.titlePlaceholder')}
                  onChangeText={setTitle}
                />
                {errors.title ? <Text accessibilityRole="alert" style={{ color: danger, fontSize: 13 }}>{message(errors.title)}</Text> : null}
                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                  placeholder={t('lifeGoals.descriptionPlaceholder')}
                  placeholderTextColor={borderColor}
                  accessibilityLabel={t('lifeGoals.descriptionPlaceholder')}
                  value={description}
                  onChangeText={setDescription}
                />
                {goal.type === 'amount' ? (
                  <>
                    <Text style={sharedStyles.fieldLabel}>{t('lifeGoals.new.unitLabel')}</Text>
                    <TextInput
                      style={[sharedStyles.input, { borderColor: errors.unit ? danger : borderColor, backgroundColor: surface, minHeight: 44 }]}
                      value={unit}
                      maxLength={24}
                      accessibilityLabel={t('lifeGoals.new.unitLabel')}
                      onChangeText={setUnit}
                    />
                    {errors.unit ? <Text accessibilityRole="alert" style={{ color: danger, fontSize: 13 }}>{message(errors.unit)}</Text> : null}
                  </>
                ) : null}
                {numeric ? (
                  <GoalValueFields
                    type={numeric}
                    label={t('lifeGoals.new.targetLabel')}
                    value={targetText}
                    onChange={setTargetText}
                    error={message(errors.target)}
                    unit={goal.type === 'amount' ? unit.trim() : undefined}
                  />
                ) : null}

                {deadline !== null ? (
                  <>
                    <Text style={sharedStyles.fieldLabel}>{t('lifeGoals.deadlineLabel')}</Text>
                    <DatePickerField value={deadline} onChange={setDeadline} />
                    <Pressable accessibilityRole="button" style={styles.linkButton} onPress={() => setDeadline(null)}>
                      <Text style={{ color: textMuted }}>{t('lifeGoals.removeDeadline')}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Pressable accessibilityRole="button" style={styles.linkButton} onPress={() => setDeadline(todayIso())}>
                    <Text style={{ color: textMuted }}>+ {t('lifeGoals.deadlineLabel')}</Text>
                  </Pressable>
                )}
                <Text style={{ color: textMuted, fontSize: 13 }}>{t('lifeGoals.new.typeFixed')}</Text>
              </Card>

              <Button label={t('lifeGoals.save')} onPress={save} />
              <Button label={t('lifeGoals.delete')} variant="danger" onPress={confirmDelete} style={styles.action} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  progressCard: { alignItems: 'center' as const, gap: 6 },
  valueText: { fontSize: 18, fontWeight: '700' as const },
  action: { marginTop: 8, minHeight: 44 },
  milestoneRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, flex: 1, minHeight: 44 },
  milestoneText: { fontSize: 15, flexShrink: 1 },
  removeButton: { minWidth: 44, minHeight: 44, alignItems: 'center' as const, justifyContent: 'center' as const },
  addRow: { flexDirection: 'row' as const, gap: 8 },
  addInput: { flex: 1 },
  addButton: {
    borderWidth: 1, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
    justifyContent: 'center' as const, minHeight: 44,
  },
  addButtonText: { fontWeight: '700' as const },
  editButton: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 4, marginRight: 8, minHeight: 44 },
  linkButton: { minHeight: 44, justifyContent: 'center' as const },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end' as const, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 12, maxHeight: '90%' as const },
};
