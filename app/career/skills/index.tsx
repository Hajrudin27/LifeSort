import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Modal, Pressable, SectionList, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import Chip from '@/components/Chip';
import SkillCategoryPicker from '@/components/SkillCategoryPicker';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCareerStore } from '@/store/useCareerStore';
import { useToastStore } from '@/store/useToastStore';
import { Skill, SkillLevel } from '@/types/career';
import { getSkillCategoryLabel } from '@/utils/cv/skillCategoryLabel';

const LEVELS: SkillLevel[] = ['beginner', 'proficient', 'expert'];

export default function SkillsScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const skills = useCareerStore((s) => s.skills);
  const addSkill = useCareerStore((s) => s.addSkill);
  const updateSkill = useCareerStore((s) => s.updateSkill);
  const removeSkill = useCareerStore((s) => s.removeSkill);
  const showToast = useToastStore((s) => s.show);

  const [name, setName] = useState('');
  const [category, setCategory] = useState('technical');
  const [level, setLevel] = useState<SkillLevel>('proficient');

  const [editTarget, setEditTarget] = useState<Skill | null>(null);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('technical');
  const [editLevel, setEditLevel] = useState<SkillLevel>('proficient');

  const canAdd = name.trim().length > 0;

  const add = () => {
    addSkill({ name: name.trim(), category, level });
    showToast(t('common.saved'));
    setName('');
  };

  const openEdit = (skill: Skill) => {
    setEditTarget(skill);
    setEditName(skill.name);
    setEditCategory(skill.category);
    setEditLevel(skill.level);
  };

  const handleLongPress = (skill: Skill) => {
    Alert.alert(skill.name, undefined, [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('career.edit'), onPress: () => openEdit(skill) },
      { text: t('career.delete'), style: 'destructive', onPress: () => removeSkill(skill.id) },
    ]);
  };

  const confirmEdit = () => {
    if (!editTarget || editName.trim().length === 0) return;
    updateSkill(editTarget.id, { name: editName.trim(), category: editCategory, level: editLevel });
    setEditTarget(null);
  };

  const usedCategories = Array.from(new Set(skills.map((sk) => sk.category)));
  const sections = usedCategories.map((c) => ({
    title: getSkillCategoryLabel(c, t),
    data: skills.filter((sk) => sk.category === c),
  }));

  return (
    <View style={sharedStyles.formContainer}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t('career.emptySkills')}</Text>
          </Card>
        }
        renderSectionHeader={({ section }) => <Text style={sharedStyles.sectionLabel}>{section.title}</Text>}
        renderItem={({ item }) => (
          <Pressable onLongPress={() => handleLongPress(item)}>
            <Card style={sharedStyles.rowBetween}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={{ color: textMuted }}>{t(`career.level.${item.level}`)}</Text>
            </Card>
          </Pressable>
        )}
      />

      <Card style={sharedStyles.card}>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('career.skillNamePlaceholder')}
          placeholderTextColor={borderColor}
          value={name}
          onChangeText={setName}
        />

        <Text style={sharedStyles.fieldLabel}>{t('career.categoryLabel')}</Text>
        <SkillCategoryPicker selected={category} onSelect={setCategory} />

        <Text style={sharedStyles.fieldLabel}>{t('career.levelLabel')}</Text>
        <View style={sharedStyles.chipRow}>
          {LEVELS.map((l) => (
            <Chip key={l} label={t(`career.level.${l}`)} active={level === l} onPress={() => setLevel(l)} />
          ))}
        </View>

        <Button label={t('career.addButton')} disabled={!canAdd} onPress={add} />
      </Card>

      <Modal visible={editTarget !== null} animationType="fade" transparent onRequestClose={() => setEditTarget(null)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, { backgroundColor, borderColor }]}>
            <Text style={styles.modalTitle}>{t('career.editSkill')}</Text>

            <TextInput
              style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
              value={editName}
              onChangeText={setEditName}
            />

            <Text style={sharedStyles.fieldLabel}>{t('career.categoryLabel')}</Text>
            <SkillCategoryPicker selected={editCategory} onSelect={setEditCategory} />

            <Text style={sharedStyles.fieldLabel}>{t('career.levelLabel')}</Text>
            <View style={sharedStyles.chipRow}>
              {LEVELS.map((l) => (
                <Chip key={l} label={t(`career.level.${l}`)} active={editLevel === l} onPress={() => setEditLevel(l)} />
              ))}
            </View>

            <View style={styles.modalButtonRow}>
              <View style={styles.modalButtonFlex}>
                <Button
                  label={t('career.delete')}
                  variant="danger"
                  onPress={() => {
                    removeSkill(editTarget!.id);
                    setEditTarget(null);
                  }}
                />
              </View>
              <View style={styles.modalButtonFlex}>
                <Button label={t('career.confirm')} onPress={confirmEdit} />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = {
  name: { fontWeight: '700' as const },
  modalBackdrop: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { width: '85%' as const, borderWidth: 1, borderRadius: 20, padding: 18, gap: 12 },
  modalTitle: { fontWeight: '700' as const, fontSize: 16, textAlign: 'center' as const },
  modalButtonRow: { flexDirection: 'row' as const, gap: 8 },
  modalButtonFlex: { flex: 1 },
};