import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, TextInput } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import { Text, useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useProfileStore } from '@/store/useProfileStore';
import { useToastStore } from '@/store/useToastStore';

const PIN_LENGTH = 4;

export default function PinSettingsScreen() {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const setPin = useProfileStore((s) => s.setPin);
  const showToast = useToastStore((s) => s.show);

  const [pin, setPinInput] = useState('');
  const [pinConfirm, setPinConfirm] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const canSave = pin.length === PIN_LENGTH && pinConfirm.length === PIN_LENGTH;

  const save = async () => {
    if (pin.length !== PIN_LENGTH) {
      setPinError(t('appLock.pinLengthError', { length: PIN_LENGTH }));
      return;
    }
    if (pin !== pinConfirm) {
      setPinError(t('appLock.pinMismatchError'));
      return;
    }
    setPinError(null);
    setIsSaving(true);
    try {
      await setPin(pin);
      showToast(t('common.saved'));
      router.back();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor }} contentContainerStyle={sharedStyles.formContainerScroll} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: t('appLock.pinSettingsTitle') }} />

      <Card style={sharedStyles.card}>
        <Text style={sharedStyles.fieldLabel}>{t('appLock.pinLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('appLock.pinPlaceholder')}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_LENGTH}
          value={pin}
          onChangeText={setPinInput}
        />

        <Text style={sharedStyles.fieldLabel}>{t('appLock.confirmPinLabel')}</Text>
        <TextInput
          style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
          placeholder={t('appLock.confirmPinPlaceholder')}
          placeholderTextColor={borderColor}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={PIN_LENGTH}
          value={pinConfirm}
          onChangeText={setPinConfirm}
        />
        <Text style={[{ fontSize: 12 }, { color: textMuted }]}>{t('appLock.pinHint')}</Text>

        {pinError && <Text style={{ color: danger, fontSize: 13 }}>{pinError}</Text>}
      </Card>

      <Button label={t('appLock.savePinButton')} disabled={!canSave || isSaving} onPress={save} />
    </ScrollView>
  );
}