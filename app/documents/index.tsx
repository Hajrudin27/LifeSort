import * as DocumentPicker from 'expo-document-picker';
import { Stack } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, ActivityIndicator, Alert, FlatList, Linking, Pressable, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import Card from '@/components/Card';
import EmptyState from '@/components/EmptyState';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useSensitiveAction } from '@/components/useSensitiveAction';
import { documentReadUrl } from '@/core/documents/documentSync';
import type { DocumentRecord } from '@/core/documents/documents';
import { useDocumentsStore } from '@/store/useDocumentsStore';

/**
 * Documents (APP-055, APP-056).
 *
 * List, add, open and delete. Deleting asks twice, in this order: a confirmation
 * that names the document and says the deletion is permanent, then the APP-024
 * proof that whoever holds the phone is its owner. Nothing reaches the server
 * before both have said yes, and the row stays in the list until the server has
 * confirmed that the file and its metadata are gone.
 *
 * Nothing technical is shown. The storage path, the signed URL and the user id
 * are how the file is reached, not what it is, and putting any of them on screen —
 * or into the confirmation — would put them in screenshots and support threads too.
 */

export default function DocumentsScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const documents = useDocumentsStore((s) => s.documents);
  const uploading = useDocumentsStore((s) => s.uploading);
  const uploadError = useDocumentsStore((s) => s.uploadError);
  const deletingId = useDocumentsStore((s) => s.deletingId);
  const deleteError = useDocumentsStore((s) => s.deleteError);
  const addDocument = useDocumentsStore((s) => s.addDocument);
  const clearUploadError = useDocumentsStore((s) => s.clearUploadError);
  const deleteDocument = useDocumentsStore((s) => s.deleteDocument);
  const clearDeleteError = useDocumentsStore((s) => s.clearDeleteError);
  const fetchFromSupabase = useDocumentsStore((s) => s.fetchFromSupabase);

  // Deleting a document is exactly what an unlocked phone on a table should not be
  // able to do on its own (APP-024).
  const { run: runSensitive, prompt: reauthPrompt } = useSensitiveAction();

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
    clearDeleteError();
    setOpenError(false);

    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    await addDocument({ uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType });
  }, [addDocument, clearDeleteError, clearUploadError]);

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

  /**
   * The confirmation names the file by the only thing the user knows it by, and
   * says what goes: the stored file and everything the app keeps about it, for
   * good. Cancelling either the confirmation or the proof leaves everything as it
   * was — the network is not touched until both have passed.
   */
  const confirmDelete = useCallback(
    (document: DocumentRecord) => {
      clearUploadError();
      clearDeleteError();
      setOpenError(false);

      Alert.alert(
        t('documents.deleteConfirmTitle'),
        t('documents.deleteConfirmBody', { name: document.originalName }),
        [
          { text: t('documents.cancel'), style: 'cancel' },
          {
            text: t('documents.deleteConfirm'),
            style: 'destructive',
            onPress: () =>
              runSensitive(async () => {
                if (await deleteDocument(document.id)) {
                  // The row simply disappears; a screen reader is told why.
                  AccessibilityInfo.announceForAccessibility(t('documents.deleted'));
                }
              }),
          },
        ],
      );
    },
    [clearDeleteError, clearUploadError, deleteDocument, runSensitive, t],
  );

  const errorMessage = uploadError
    ? t(`documents.errors.${uploadError}`)
    : deleteError
      ? t(`documents.deleteErrors.${deleteError}`)
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
            const opening = openingId === item.id;
            const deleting = deletingId === item.id;
            // One deletion at a time, so every delete control waits for the one in flight.
            const deleteBlocked = deletingId !== null;
            return (
              // Two sibling controls, never one inside the other: each is its own
              // target for touch and for a screen reader.
              <Card style={styles.rowCard}>
                <Pressable
                  accessibilityRole="button"
                  // The label carries the name AND the date, because the icon and
                  // the muted date line are not announced on their own.
                  accessibilityLabel={t('documents.openLabel', { name: item.originalName, date: savedOn })}
                  accessibilityState={{ disabled: opening || deleting, busy: opening }}
                  disabled={opening || deleting}
                  onPress={() => open(item)}
                  style={({ pressed }) => [styles.openArea, { opacity: pressed ? 0.6 : 1 }]}
                >
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
                      {deleting
                        ? t('documents.deleting')
                        : opening
                          ? t('documents.opening')
                          : t('documents.savedOn', { date: savedOn })}
                    </Text>
                  </View>
                  {opening && <ActivityIndicator />}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('documents.deleteLabel', { name: item.originalName })}
                  accessibilityHint={t('documents.deleteHint')}
                  accessibilityState={{ disabled: deleteBlocked, busy: deleting }}
                  disabled={deleteBlocked}
                  onPress={() => confirmDelete(item)}
                  hitSlop={4}
                  style={({ pressed }) => [styles.deleteButton, { opacity: pressed || deleteBlocked ? 0.5 : 1 }]}
                >
                  {deleting ? (
                    <ActivityIndicator />
                  ) : (
                    <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={20} tintColor={danger} />
                  )}
                </Pressable>
              </Card>
            );
          }}
        />
      )}

      {reauthPrompt}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, gap: 12 },
  intro: { fontSize: 14, lineHeight: 20 },
  errorCard: { padding: 12 },
  loading: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  list: { gap: 10, paddingBottom: 24 },
  rowCard: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingLeft: 14, paddingRight: 4 },
  openArea: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingVertical: 10 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 13 },
  deleteButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
