import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, TextInput } from 'react-native';

import SelectField from '@/components/SelectField';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useSkillCategoriesStore } from '@/store/useSkillCategoriesStore';
import { getSkillCategoryLabel } from '@/utils/cv/skillCategoryLabel';

type Props = {
  selected: string;
  onSelect: (categoryId: string) => void;
};

export default function SkillCategoryPicker({ selected, onSelect }: Props) {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');

  const categories = useSkillCategoriesStore((s) => s.categories);
  const addCategory = useSkillCategoriesStore((s) => s.addCategory);

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');

  const options = categories.map((c) => ({ id: c.id, label: getSkillCategoryLabel(c.id, t) }));

  const confirmAdd = () => {
    if (newName.trim().length === 0) return;
    const id = addCategory(newName);
    onSelect(id);
    setNewName('');
    setIsAdding(false);
  };

  return (
    <SelectField
      options={options}
      selected={selected}
      onSelect={onSelect}
      placeholder={t('career.selectCategory')}
      modalTitle={t('career.selectCategory')}
      footer={
        isAdding ? (
          <View style={styles.addRow}>
            <TextInput
              style={[sharedStyles.input, styles.addInput, { borderColor, backgroundColor: surface }]}
              placeholder={t('career.newCategoryPlaceholder')}
              placeholderTextColor={borderColor}
              value={newName}
              onChangeText={setNewName}
              autoFocus
              onSubmitEditing={confirmAdd}
            />
            <Pressable accessibilityRole="button" style={[styles.confirmBtn, { borderColor }]} onPress={confirmAdd}>
              <Text>{t('career.addCategoryConfirm')}</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable accessibilityRole="button" style={[styles.addLinkRow, { borderColor }]} onPress={() => setIsAdding(true)}>
            <Text>+ {t('career.addCategory')}</Text>
          </Pressable>
        )
      }
    />
  );
}

const styles = {
  addRow: { flexDirection: 'row' as const, gap: 8, marginTop: 8 },
  addInput: { flex: 1 },
  confirmBtn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' as const },
  addLinkRow: { borderWidth: 1, borderRadius: 10, padding: 12, marginTop: 8, alignItems: 'center' as const },
};