import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';
import { Language, useSettingsStore } from '@/store/useSettingsStore';

export default function LanguageScreen() {
  const { t } = useTranslation();
  const setLanguage = useSettingsStore((s) => s.setLanguage);

  const choose = (lang: Language) => {
    setLanguage(lang);
    router.replace('/(tabs)');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{t('language.chooseTitle')}</Text>

      <Pressable accessibilityRole="radio" style={styles.button} onPress={() => choose('da')}>
        <Text style={styles.buttonText}>🇩🇰 Dansk</Text>
      </Pressable>

      <Pressable accessibilityRole="radio" style={styles.button} onPress={() => choose('en')}>
        <Text style={styles.buttonText}>🇬🇧 English</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  title: { fontSize: 22, fontWeight: 'bold', marginBottom: 24 },
  button: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 32,
  },
  buttonText: { fontSize: 18 },
});