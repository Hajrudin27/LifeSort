import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView } from 'react-native';

import GiftForm from '@/components/GiftForm';
import { useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useGiftsStore } from '@/store/useGiftsStore';

export default function NewGiftScreen() {
  const { t } = useTranslation();
  const addGift = useGiftsStore((s) => s.addGift);
  const backgroundColor = useThemeColor({}, 'background');

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <GiftForm
        submitLabel={t('gifts.create')}
        onSubmit={(input) => {
          const result = addGift(input);
          if (!result.ok) return result.errors;
          router.back();
          return null;
        }}
      />
    </ScrollView>
  );
}
