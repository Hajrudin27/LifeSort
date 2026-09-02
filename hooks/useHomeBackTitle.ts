import { useNavigation } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function useHomeBackTitle(fromParam: string | undefined) {
  const navigation = useNavigation();
  const { t } = useTranslation();

  useEffect(() => {
    if (fromParam === 'home') {
      navigation.setOptions({ headerBackTitle: t('home.title') });
    }
  }, [fromParam]);
}