import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import Kicker from '@/components/Kicker';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCycleStore } from '@/store/useCycleStore';
import { useToastStore } from '@/store/useToastStore';

export default function CycleSettingsScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const avgCycleLength = useCycleStore((s) => s.avgCycleLength);
  const lutealPhaseLength = useCycleStore((s) => s.lutealPhaseLength);
  const reminderEnabled = useCycleStore((s) => s.reminderEnabled);
  const reminderDaysBefore = useCycleStore((s) => s.reminderDaysBefore);
  const setLutealPhaseLength = useCycleStore((s) => s.setLutealPhaseLength);
  const setReminderEnabled = useCycleStore((s) => s.setReminderEnabled);
  const setReminderDaysBefore = useCycleStore((s) => s.setReminderDaysBefore);
  const showToast = useToastStore((s) => s.show);

  const [luteal, setLuteal] = useState(lutealPhaseLength.toString());

  const save = () => {
    const lutealNum = parseInt(luteal, 10);
    if (!isNaN(lutealNum) && lutealNum > 0) setLutealPhaseLength(lutealNum);
    showToast(t('common.saved'));
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Card style={[sharedStyles.card, styles.section, { borderColor: cycleTints.accentSoft }]}>
        <Kicker
          label={t('cycle.reminderToggleLabel')}
          color={cycleTints.accent}
          backgroundColor={cycleTints.accentSoft}
          style={styles.kickerSpacing}
        />
        <Text style={{ color: textMuted, fontSize: 12 }}>{t('cycle.reminderToggleHint')}</Text>
        <Chip
          label={t('cycle.reminderToggleLabel')}
          active={reminderEnabled}
          onPress={() => setReminderEnabled(!reminderEnabled)}
        />

        {reminderEnabled && (
          <>
            <Text style={sharedStyles.fieldLabel}>{t('cycle.reminderDaysBeforeLabel')}</Text>
            <View style={sharedStyles.chipRow}>
              {[1, 2, 3].map((days) => (
                <Chip
                  key={days}
                  label={t('cycle.daysBeforeOption', { count: days })}
                  active={reminderDaysBefore === days}
                  onPress={() => setReminderDaysBefore(days)}
                />
              ))}
            </View>
          </>
        )}
      </Card>

      <Card style={[sharedStyles.card, styles.section, { borderColor: cycleTints.accentSoft }]}>
        <Kicker
          label={t('cycle.avgCycleLengthLabel')}
          color={cycleTints.accent}
          backgroundColor={cycleTints.accentSoft}
          style={styles.kickerSpacing}
        />
        <View style={[styles.autoValueBox, { backgroundColor: cycleTints.accentSoft }]}>
          <Text style={[styles.autoValue, { color: cycleTints.accent }]}>{avgCycleLength} {t('cycle.daysUnit')}</Text>
        </View>
        <Text style={[styles.autoHint, { color: textMuted }]}>{t('cycle.avgCycleLengthAutoHint')}</Text>

        <Text style={sharedStyles.fieldLabel}>{t('cycle.lutealPhaseLengthLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          keyboardType="number-pad"
          value={luteal}
          onChangeText={setLuteal}
        />
      </Card>

      <Button label={t('cycle.save')} onPress={save} />
    </ScrollView>
  );
}

const styles = {
  kickerSpacing: { marginBottom: 2 },
  section: { borderWidth: 1.5 },
  autoValueBox: { alignSelf: 'flex-start' as const, borderRadius: 14, paddingVertical: 8, paddingHorizontal: 14 },
  autoValue: { fontSize: 20, fontWeight: '800' as const },
  autoHint: { fontSize: 12, marginTop: -2 },
};