import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Button from '@/components/Button';
import { Text, useThemeColor } from '@/components/Themed';
import { useAuthStore } from '@/store/useAuthStore';
import { useSyncStatusStore } from '@/store/useSyncStatusStore';

/** One non-overlay shell surface. Only generic localized copy reaches the tree. */
export default function SyncStatusBanner() {
  const { t } = useTranslation();
  const accountId = useAuthStore((state) => state.session?.user.id ?? null);
  const projection = useSyncStatusStore((state) => state.projection);
  const retry = useSyncStatusStore((state) => state.retry);
  const backgroundColor = useThemeColor({}, 'surfaceMuted');
  const borderColor = useThemeColor({}, 'border');
  const textColor = useThemeColor({}, 'textMuted');
  if (!accountId || projection.accountId !== accountId || projection.status === 'clear') return null;

  const key = projection.errorCode === 'auth-required' ? 'authRequired'
    : projection.status === 'needs-attention' ? 'needsAttention' : projection.status;
  const message = t(`common.syncStatus.${key}`);
  const retryLabel = t(`common.syncStatus.${projection.retrying ? 'retrying' : 'retry'}`);
  return (
    <SafeAreaView edges={['bottom', 'left', 'right']} style={{ backgroundColor }}>
      <View style={[styles.surface, { borderColor }]}>
        <Text accessibilityRole="text" accessibilityLiveRegion="polite" accessibilityLabel={message}
          style={[styles.message, { color: textColor }]}>{message}</Text>
        {projection.retryMutationId !== null && (
          <Button label={retryLabel} accessibilityLabel={retryLabel} variant="secondary"
            disabled={projection.retrying} style={styles.retry}
            onPress={() => {
              if (!projection.retrying && projection.retryMutationId) {
                void retry(accountId, projection.retryMutationId);
              }
            }} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  surface: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  message: { fontSize: 13, flexShrink: 1 },
  retry: { alignSelf: 'flex-start', maxWidth: '100%', minHeight: 44, paddingVertical: 10, paddingHorizontal: 16 },
});
