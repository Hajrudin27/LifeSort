import { useTranslation } from 'react-i18next';
import { StyleSheet, TextInput } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import type { GoalValueText, NumericGoalType } from '@/features/goals/domain/goalInput';

interface Props {
  type: NumericGoalType;
  label: string;
  value: GoalValueText;
  onChange: (next: GoalValueText) => void;
  /** Already localized. Announced as part of the field, not only shown in colour. */
  error?: string;
  unit?: string;
}

/** The typed inputs for one goal value: one field for count/amount, hours + minutes for duration. */
export default function GoalValueFields({ type, label, value, onChange, error, unit }: Props) {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const danger = useThemeColor({}, 'danger');
  const textMuted = useThemeColor({}, 'textMuted');
  const input = [sharedStyles.input, styles.input, { borderColor: error ? danger : borderColor, backgroundColor: surface }];

  return (
    <View style={styles.wrap}>
      <Text style={sharedStyles.fieldLabel}>{label}</Text>
      {type === 'duration' ? (
        <View style={styles.row}>
          <View style={styles.cell}>
            <TextInput
              style={input}
              value={value.hours}
              onChangeText={(hours) => onChange({ ...value, hours })}
              keyboardType="number-pad"
              accessibilityLabel={`${label}: ${t('lifeGoals.new.hoursLabel')}`}
              placeholder={t('lifeGoals.new.hoursLabel')}
              placeholderTextColor={borderColor}
            />
          </View>
          <View style={styles.cell}>
            <TextInput
              style={input}
              value={value.minutes}
              onChangeText={(minutes) => onChange({ ...value, minutes })}
              keyboardType="number-pad"
              accessibilityLabel={`${label}: ${t('lifeGoals.new.minutesLabel')}`}
              placeholder={t('lifeGoals.new.minutesLabel')}
              placeholderTextColor={borderColor}
            />
          </View>
        </View>
      ) : (
        <View style={styles.row}>
          <View style={styles.cell}>
            <TextInput
              style={input}
              value={value.text}
              onChangeText={(text) => onChange({ ...value, text })}
              keyboardType={type === 'amount' ? 'decimal-pad' : 'number-pad'}
              accessibilityLabel={label}
              placeholderTextColor={borderColor}
            />
          </View>
          {type === 'amount' && unit ? <Text style={{ color: textMuted }}>{unit}</Text> : null}
        </View>
      )}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: danger }]}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cell: { flex: 1 },
  input: { minHeight: 44 },
  error: { fontSize: 13 },
});
