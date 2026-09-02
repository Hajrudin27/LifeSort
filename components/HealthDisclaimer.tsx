import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';

export default function HealthDisclaimer() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const warning = useThemeColor({}, 'warning');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');

  return (
    <View style={[styles.box, { backgroundColor: surfaceMuted, borderColor: warning }]}>
      <View style={[styles.iconCircle, { backgroundColor: warning }]}>
        <SymbolView name={{ ios: 'exclamationmark.triangle.fill', android: 'warning', web: 'warning' }} size={14} tintColor="#FFFFFF" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: warning }]}>{t('healthInfo.disclaimerTitle')}</Text>
        <Text style={styles.body}>{t('healthInfo.disclaimerBody')}</Text>
      </View>
    </View>
  );
}

const styles = {
  box: { flexDirection: 'row' as const, borderWidth: 1.5, borderRadius: 16, padding: 14, gap: 10 },
  iconCircle: { width: 26, height: 26, borderRadius: 13, alignItems: 'center' as const, justifyContent: 'center' as const, marginTop: 1 },
  title: { fontWeight: '800' as const, fontSize: 13, marginBottom: 3 },
  body: { fontSize: 12, lineHeight: 17 },
};