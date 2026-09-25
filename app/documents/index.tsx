import * as DocumentPicker from 'expo-document-picker';
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { Text, useThemeColor, View } from '@/components/Themed';
import { documentReadUrl } from '@/core/documents/documentSync';
import type { DocumentRecord } from '@/core/documents/documents';
import { useDocumentsStore } from '@/store/useDocumentsStore';

/**
 * Documents (APP-055).
 *
 * The smallest surface that makes the story real: list, add, open. There is no
 * delete action here on purpose — APP-056 owns the cascade that has to remove the
 * object, the row and anything derived from them, and a button that removed only
 * one of the three would be worse than no button.
 *
 * Nothing technical is shown. The storage path, the signed URL and the user id
 * are how the file is reached, not what it is, and putting any of them on screen
 * would put them in screenshots and support threads too.
 */

export default function DocumentsScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const documents = useDocumentsStore((s) => s.documents);
  const uploading = useDocumentsStore((s) => s.uploading);
  const uploadError = useDocumentsStore((s) => s.uploadError);
  const addDocument = useDocumentsStore((s) => s.addDocument);
  const clearUploadError = useDocumentsStore((s) => s.clearUploadError);
  const fetchFromSupabase = useDocumentsStore((s) => s.fetchFromSupabase);

  const [loading, setLoading] = useState(true);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchFromSupabase().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchFromSupabase]);

  const formatDate = useCallback(
    (iso: string) =>
      new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })
        .format(new Date(iso)),
    [i18n.language],
  );

  const pickAndUpload = useCallback(async () => {
    clearUploadError();
    setOpenError(false);

    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    await addDocument({ uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType });
  }, [addDocument, clearUploadError]);

  /**
   * The URL is requested here and nowhere else, at the moment the row is tapped,
   * and it is dropped as soon as the OS has been handed it. It is never put into
   * state that persists, because a signed URL reaches the file without a login.
   */
  const open = useCallback(async (document: DocumentRecord) => {
    setOpenError(false);
    setOpeningId(document.id);
    try {
      const url = await documentReadUrl(document.storagePath);
      if (!url) {
        setOpenError(true);
        return;
      }
      await Linking.openURL(url);
    } catch {
      setOpenError(true);
    } finally {
      setOpeningId(null);
    }
  }, []);

  const errorMessage = uploadError
    ? t(`documents.errors.${uploadError}`)
    : openError
      ? t('documents.errors.open-failed')
      : null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: t('documents.title') }} />

      <Text style={[styles.intro, { color: textMuted }]}>{t('documents.intro')}</Text>

      <Button
        label={uploading ? t('documents.uploading') : t('documents.upload')}
        onPress={pickAndUpload}
        disabled={uploading}
        accessibilityRole="button"
        accessibilityLabel={t('documents.upload')}
        accessibilityHint={t('documents.uploadHint')}
        accessibilityState={{ disabled: uploading, busy: uploading }}
      />

      {errorMessage && (
        // accessibilityLiveRegion so a screen reader announces the failure rather
        // than leaving it to be discovered by exploring the screen.
        <Card
          accessible
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          accessibilityLabel={errorMessage}
          style={styles.errorCard}
        >
          <Text style={{ color: danger }}>{errorMessage}</Text>
        </Card>
      )}

      {loading ? (
        <View accessibilityLiveRegion="polite" style={styles.loading}>
          <ActivityIndicator accessibilityLabel={t('documents.loading')} />
          <Text style={{ color: textMuted }}>{t('documents.loading')}</Text>
        </View>
      ) : documents.length === 0 ? (
        <EmptyState
          icon={{ ios: 'doc.fill', android: 'description', web: 'description' }}
          title={t('documents.empty')}
          subtitle={t('documents.emptyHint')}
        />
      ) : (
        <FlatList
          data={documents}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const savedOn = formatDate(item.createdAt);
            const busy = openingId === item.id;
            return (
              <Pressable
                accessibilityRole="button"
                // The label carries the name AND the date, because the icon and
                // the muted date line are not announced on their own.
                accessibilityLabel={t('documents.openLabel', { name: item.originalName, date: savedOn })}
                accessibilityState={{ disabled: busy, busy }}
                disabled={busy}
                onPress={() => open(item)}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
              >
                <Card style={styles.rowCard}>
                  <SymbolView
                    name={{ ios: 'doc.fill', android: 'description', web: 'description' }}
                    size={20}
                    tintColor={textMuted}
                  />
                  <View style={styles.rowText}>
                    <Text numberOfLines={2} style={styles.name}>
                      {item.originalName}
                    </Text>
                    <Text style={[styles.meta, { color: textMuted }]}>
                      {busy ? t('documents.opening') : t('documents.savedOn', { date: savedOn })}
                    </Text>
                  </View>
                  {busy && <ActivityIndicator />}
                </Card>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  intro: { fontSize: 14, lineHeight: 20 },
  errorCard: { padding: 12 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  list: { gap: 10, paddingBottom: 24 },
  row: { minHeight: 44 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 13 },
});
