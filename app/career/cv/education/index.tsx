import { router, Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCVStore } from '@/store/useCVStore';
import { formatCvDateRange } from '@/utils/cv/cvDateFormat';

export default function EducationListScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const locale = i18n.language === 'da' ? 'da-DK' : 'en-US';
  const education = useCVStore((s) => s.education);
  const sorted = [...education].sort((a, b) => b.startDate.localeCompare(a.startDate));

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: t('cv.educationLabel') }} />
      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={<Text style={[sharedStyles.emptyState, { color: textMuted }]}>{t('cv.emptyEducation')}</Text>}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/career/cv/education/${item.id}`)}>
            <Card>
              <Text style={styles.title}>{item.degree}{item.fieldOfStudy ? `, ${item.fieldOfStudy}` : ''}</Text>
              <Text style={{ color: textMuted }}>{item.school}</Text>
              <Text style={[styles.dates, { color: textMuted }]}>{formatCvDateRange(item.startDate, item.endDate, locale, t('cv.current'))}</Text>
            </Card>
          </Pressable>
        )}
      />
      <Button label={t('cv.addEducation')} onPress={() => router.push('/career/cv/education/new')} />
    </View>
  );
}

const styles = { title: { fontWeight: '700' as const }, dates: { fontSize: 12, marginTop: 2 } };