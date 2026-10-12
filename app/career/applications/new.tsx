import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import ApplicationForm from '@/components/ApplicationForm';
import { useThemeColor } from '@/components/Themed';
import { sharedStyles } from '@/constants/sharedStyles';
import { useCareerStore } from '@/store/useCareerStore';

export default function NewApplicationScreen() {
  const addApplication = useCareerStore((s) => s.addApplication);
  const backgroundColor = useThemeColor({}, 'background');

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <ApplicationForm
        onSubmit={(input) => {
          const result = addApplication(input);
          if (!result.ok) return result.errors;
          router.back();
          return null;
        }}
      />
    </ScrollView>
  );
}
