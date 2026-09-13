import { ScrollView, Text, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Colors from '@/constants/Colors';

/** Available before persisted preferences or the normal theme provider are safe. */
export default function StorageStartupFailure() {
  const systemScheme = useColorScheme();
  const colors = Colors[systemScheme === 'dark' ? 'dark' : 'light'];
  const { t } = useTranslation();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24 }}>
        <Text accessibilityRole="alert" allowFontScaling style={{ color: colors.text, fontSize: 18 }}>
          {t('common.localDataUnavailable')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
