import { router, Stack, useLocalSearchParams } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, Modal, Pressable, ScrollView } from 'react-native';

import ApplicationForm from '@/components/ApplicationForm';
import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { openableLink } from '@/features/career/domain/application';
import { useAccentTints } from '@/hooks/useAccentTints';
import { useCareerStore } from '@/store/useCareerStore';

export default function ApplicationDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, 'border');
  const backgroundColor = useThemeColor({}, 'background');
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const textMuted = useThemeColor({}, 'textMuted');

  const application = useCareerStore((s) => s.applications.find((a) => a.id === id));
  const updateApplication = useCareerStore((s) => s.updateApplication);
  const removeApplication = useCareerStore((s) => s.removeApplication);

  const [showEdit, setShowEdit] = useState(false);

  if (!application) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('career.notFound')}</Text>
      </View>
    );
  }

  // Only a canonical http(s) address is ever handed to the OS; anything else a legacy row holds is shown as text.
  const link = openableLink(application.link);

  const openLink = () => {
    if (!link) return;
    // Rejection (no handler, user cancelled) is expected and carries nothing worth logging.
    Linking.openURL(link).catch(() => undefined);
  };

  // Deletion is local and permanent: always ask first.
  const confirmDelete = () => {
    Alert.alert(t('career.deleteConfirmTitle'), t('career.deleteConfirmMessage'), [
      { text: t('career.cancel'), style: 'cancel' },
      {
        text: t('career.delete'),
        style: 'destructive',
        onPress: () => {
          removeApplication(application.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled">
      <Stack.Screen
        options={{
          title: application.position,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('career.edit')}
              onPress={() => setShowEdit(true)}
              style={styles.editButton}>
              <SymbolView name={{ ios: 'pencil', android: 'edit', web: 'edit' }} size={20} tintColor={textMuted} />
              <Text style={{ color: textMuted }}>{t('career.edit')}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.headerCard}>
        <Text style={styles.company}>{application.company}</Text>
        <Text style={{ color: textMuted }}>{application.appliedDate}</Text>
        <Text style={[styles.statusText, { color: tint }]}>{t(`career.status.${application.status}`)}</Text>
      </Card>

      {application.link &&
        (link ? (
          <Button label={application.link} accessibilityLabel={`${t('career.openLink')}: ${application.link}`} variant="secondary" onPress={openLink} />
        ) : (
          <Card>
            <Text selectable>{application.link}</Text>
            <Text style={{ color: textMuted, fontSize: 13 }}>{t('career.invalidLinkNotOpened')}</Text>
          </Card>
        ))}

      {application.notes && (
        <Card>
          <Text selectable>{application.notes}</Text>
        </Card>
      )}

      <Button label={t('career.delete')} variant="danger" onPress={confirmDelete} />

      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <Pressable accessible={false} style={styles.modalBackdrop} onPress={() => setShowEdit(false)}>
          <Pressable
            accessible={false}
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <ApplicationForm
                initial={{
                  company: application.company,
                  position: application.position,
                  status: application.status,
                  appliedDate: application.appliedDate,
                  link: application.link,
                  notes: application.notes,
                }}
                onSubmit={(input) => {
                  const result = updateApplication(application.id, input);
                  if (!result.ok) return result.errors;
                  setShowEdit(false);
                  return null;
                }}
              />
              <Button label={t('career.cancel')} variant="secondary" onPress={() => setShowEdit(false)} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  headerCard: { alignItems: 'center' as const, gap: 4 },
  company: { fontWeight: '700' as const, fontSize: 16 },
  statusText: { fontWeight: '700' as const, marginTop: 4 },
  editButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginRight: 8,
    minHeight: 44,
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'flex-end' as const,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  modalCard: {
    maxHeight: '90%' as const,
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
};
