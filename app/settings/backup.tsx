import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useToastStore } from '@/store/useToastStore';
import { exportBackup, importBackup } from '@/utils/shared/dataBackup';

export default function BackupScreen() {
  const { t } = useTranslation();
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const showToast = useToastStore((s) => s.show);

  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportBackup();
      showToast(t('backup.exportSuccess'));
    } finally {
      setIsExporting(false);
    }
  };

  const runImport = async () => {
    setIsImporting(true);
    try {
      const result = await importBackup();
      if (!result) return; // brugeren annullerede filvalget

      if (!result.success) {
        const message =
          result.error === 'invalid_format' ? t('backup.importErrorInvalidFormat') : t('backup.importErrorParseFailed');
        Alert.alert(t('backup.importErrorTitle'), message);
        return;
      }

      showToast(t('backup.importSuccess'));
    } finally {
      setIsImporting(false);
    }
  };

  const handleImport = () => {
    Alert.alert(t('backup.importConfirmTitle'), t('backup.importConfirmMessage'), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('backup.importConfirmButton'), style: 'destructive', onPress: runImport },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll}>
      <Card style={styles.card}>
        <Text style={styles.label}>{t('backup.exportLabel')}</Text>
        <Text style={{ color: textMuted, fontSize: 13 }}>{t('backup.exportDescription')}</Text>
        <Button label={t('backup.exportLabel')} disabled={isExporting} onPress={handleExport} />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.label}>{t('backup.importLabel')}</Text>
        <Text style={{ color: textMuted, fontSize: 13 }}>{t('backup.importDescription')}</Text>
        <Button label={t('backup.importLabel')} variant="secondary" disabled={isImporting} onPress={handleImport} />
      </Card>
    </ScrollView>
  );
}

const styles = {
  card: { gap: 10 },
  label: { fontWeight: '700' as const, fontSize: 16 },
};