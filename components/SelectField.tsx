import { SymbolView } from 'expo-symbols';
import { ReactNode, useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

export type SelectOption = { id: string; label: string };

type Props = {
  options: SelectOption[];
  selected: string;
  onSelect: (id: string) => void;
  placeholder: string;
  modalTitle: string;
  footer?: ReactNode;
};

export default function SelectField({ options, selected, onSelect, placeholder, modalTitle, footer }: Props) {
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const accentTints = useAccentTints();
  const tint = accentTints.accent;

  const [isOpen, setIsOpen] = useState(false);
  const selectedLabel = options.find((o) => o.id === selected)?.label ?? placeholder;

  return (
    <>
      <Pressable style={[styles.field, { borderColor, backgroundColor: surface }]} onPress={() => setIsOpen(true)}>
        <Text style={styles.fieldText}>{selectedLabel}</Text>
        <SymbolView name={{ ios: 'chevron.down', android: 'expand_more', web: 'expand_more' }} size={16} tintColor={textMuted} />
      </Pressable>

      <Modal visible={isOpen} animationType="slide" transparent onRequestClose={() => setIsOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setIsOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.modalTitle}>{modalTitle}</Text>
            {options.map((o) => (
              <Pressable
                key={o.id}
                style={[styles.optionRow, { borderColor }]}
                onPress={() => {
                  onSelect(o.id);
                  setIsOpen(false);
                }}>
                <Text style={o.id === selected ? { color: tint, fontWeight: '700' } : undefined}>{o.label}</Text>
              </Pressable>
            ))}
            {footer}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fieldText: { fontSize: 15 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { maxHeight: '70%', borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 8 },
  modalTitle: { fontWeight: '700', fontSize: 16, marginBottom: 8, textAlign: 'center' },
  optionRow: { borderWidth: 1, borderRadius: 10, padding: 12 },
});