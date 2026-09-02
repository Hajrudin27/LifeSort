import { Picker } from '@react-native-picker/picker';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import { Text, useThemeColor, View } from '@/components/Themed';

type Props = {
  value: string; // ISO date, e.g. "2026-09-12"
  onChange: (isoDate: string) => void;
  yearsBack?: number; // hvor mange år bagud i tid, der skal kunne vælges
  yearsForward?: number; // hvor mange år frem i tid, der skal kunne vælges
};

const pad = (n: number) => n.toString().padStart(2, '0');

export default function DatePickerField({ value, onChange, yearsBack = 80, yearsForward = 10 }: Props) {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');

  const [isOpen, setIsOpen] = useState(false);

  const today = new Date();
  const [year, month, day] = value
    ? value.split('-').map(Number)
    : [today.getFullYear(), today.getMonth() + 1, today.getDate()];

  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';

  const monthNames = Array.from({ length: 12 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(2000, i, 1))
  );

  const daysInMonth = new Date(year, month, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const years = Array.from(
    { length: yearsBack + yearsForward + 1 },
    (_, i) => today.getFullYear() - yearsBack + i
  );

  const update = (newYear: number, newMonth: number, newDay: number) => {
    const clampedDay = Math.min(newDay, new Date(newYear, newMonth, 0).getDate());
    onChange(`${newYear}-${pad(newMonth)}-${pad(clampedDay)}`);
  };

  const displayLabel = value
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(
        new Date(year, month - 1, day)
      )
    : t('datePicker.selectDate');

  return (
    <>
      <Pressable style={[styles.field, { borderColor, backgroundColor: surface }]} onPress={() => setIsOpen(true)}>
        <Text style={styles.fieldText}>{displayLabel}</Text>
      </Pressable>

      <Modal visible={isOpen} animationType="slide" transparent onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.row}>
              <Picker style={styles.picker} selectedValue={month} onValueChange={(m) => update(year, Number(m), day)}>
                {monthNames.map((name, i) => (
                  <Picker.Item key={i} label={name} value={i + 1} />
                ))}
              </Picker>

              <Picker style={styles.picker} selectedValue={day} onValueChange={(d) => update(year, month, Number(d))}>
                {days.map((d) => (
                  <Picker.Item key={d} label={d.toString()} value={d} />
                ))}
              </Picker>

              <Picker style={styles.picker} selectedValue={year} onValueChange={(y) => update(Number(y), month, day)}>
                {years.map((y) => (
                  <Picker.Item key={y} label={y.toString()} value={y} />
                ))}
              </Picker>
            </View>

            <Button label={t('datePicker.done')} onPress={() => setIsOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: { borderWidth: 1, borderRadius: 12, padding: 14 },
  fieldText: { fontSize: 15 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 12 },
  row: { flexDirection: 'row' },
  picker: { flex: 1 },
});