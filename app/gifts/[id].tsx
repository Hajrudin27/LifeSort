import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView } from 'react-native';

import Button from '@/components/Button';
import GiftForm from '@/components/GiftForm';
import { Text, useThemeColor, View } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useGiftsStore } from '@/store/useGiftsStore';

/** Edit one gift in place. The same form creates and edits; every rule lives in the Gifts domain. */
export default function GiftDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const backgroundColor = useThemeColor({}, 'background');

  const gift = useGiftsStore((s) => s.gifts.find((g) => g.id === id));
  const updateGift = useGiftsStore((s) => s.updateGift);
  const removeGift = useGiftsStore((s) => s.removeGift);

  if (!gift) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t('gifts.notFound')}</Text>
      </View>
    );
  }

  // Deletion is local and permanent, and a purchased gift's history goes with it: always ask first.
  const confirmDelete = () => {
    Alert.alert(t('gifts.deleteConfirmTitle'), t('gifts.deleteConfirmMessage'), [
      { text: t('gifts.cancel'), style: 'cancel' },
      {
        text: t('gifts.delete'),
        style: 'destructive',
        onPress: () => {
          removeGift(gift.id);
          router.back();
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <GiftForm
        key={gift.id}
        initial={gift}
        submitLabel={t('gifts.save')}
        onSubmit={(input) => {
          const result = updateGift(gift.id, input);
          if (!result.ok) return result.errors;
          router.back();
          return null;
        }}
      />
      <Button label={t('gifts.delete')} variant="danger" onPress={confirmDelete} />
    </ScrollView>
  );
}
