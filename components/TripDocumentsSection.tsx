import * as DocumentPicker from 'expo-document-picker';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import { Text, useThemeColor, View } from '@/components/Themed';
import { fetchDocumentReferences, type DocumentReference } from '@/core/documents/documentReferences';
import { cleanupTemporaryPickerFile, uploadDocument } from '@/core/documents/documentSync';
import { useTripsStore } from '@/store/useTripsStore';
import { moveLegacyTripDocumentToDocuments } from '@/utils/trip/legacyTripDocuments';
import { fetchTripDocumentLinks, linkTripDocument, unlinkTripDocument } from '@/utils/trip/tripRemote';

/**
 * A trip's documents (APP-058).
 *
 * A trip does not hold files. It holds LINKS to the user's standalone Documents
 * (APP-055), read for display through the narrow reference boundary — an id, a name
 * and a date, never a path, a URL or bytes. Adding a new file saves it as a
 * standalone Document first, through the existing uploader, and links what the
 * server confirmed. Unlinking removes the link, never the Document.
 *
 * Files a trip already had on this device (before APP-058) are shown separately,
 * as on-device only, and moved to Documents only when the user asks, one at a time.
 *
 * Links are owner-only; a participant is not shown this section at all.
 */

type Message = 'upload-failed' | 'link-failed' | 'unlink-failed' | 'invalid-file' | 'unreadable' | 'moved' | null;

type Props = { tripId: string };

export default function TripDocumentsSection({ tripId }: Props) {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const legacy = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId)?.documents ?? []);
  const removeTripDocument = useTripsStore((s) => s.removeTripDocument);

  /** undefined while loading, null when the read failed. */
  const [links, setLinks] = useState<string[] | null | undefined>(undefined);
  const [references, setReferences] = useState<DocumentReference[] | null | undefined>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLinks(undefined);
    setReferences(undefined);
    fetchTripDocumentLinks(tripId).then((result) => { if (!cancelled) setLinks(result); }).catch(() => { if (!cancelled) setLinks(null); });
    fetchDocumentReferences().then((result) => { if (!cancelled) setReferences(result); }).catch(() => { if (!cancelled) setReferences(null); });
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => load(), [load]);

  const refreshLinks = () => fetchTripDocumentLinks(tripId).then(setLinks).catch(() => setLinks(null));
  const refreshReferences = () => fetchDocumentReferences().then(setReferences).catch(() => setReferences(null));

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));
  const nameOf = (documentId: string) =>
    Array.isArray(references) ? references.find((r) => r.id === documentId)?.originalName : undefined;

  const link = async (documentId: string) => {
    setMessage(null);
    setBusy(documentId);
    const result = await linkTripDocument(tripId, documentId);
    setBusy(null);
    if (result === 'failed') { setMessage('link-failed'); return; }
    setPickerOpen(false);
    await refreshLinks();
  };

  const unlink = async (documentId: string) => {
    setMessage(null);
    setBusy(documentId);
    const ok = await unlinkTripDocument(tripId, documentId);
    setBusy(null);
    if (!ok) { setMessage('unlink-failed'); return; }
    await refreshLinks();
  };

  const addFile = async () => {
    setMessage(null);
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setBusy('add-file');
    try {
      const uploaded = await uploadDocument({ uri: asset.uri, name: asset.name, size: asset.size, mimeType: asset.mimeType });
      if (!uploaded.ok) { setMessage(uploaded.reason === 'invalid-file' ? 'invalid-file' : 'upload-failed'); return; }
      const linked = await linkTripDocument(tripId, uploaded.document.id);
      // The Document exists either way; only the link is missing if this failed.
      if (linked === 'failed') { setMessage('link-failed'); await refreshReferences(); return; }
      await Promise.all([refreshLinks(), refreshReferences()]);
    } finally {
      // The picker's temporary plaintext copy, deleted only if it is provably ours.
      await cleanupTemporaryPickerFile(asset.uri);
      setBusy(null);
    }
  };

  const moveLegacy = async (attachmentId: string) => {
    const attachment = legacy.find((a) => a.id === attachmentId);
    if (!attachment) return;
    setMessage(null);
    setBusy(`legacy:${attachmentId}`);
    const result = await moveLegacyTripDocumentToDocuments(tripId, attachment, () => removeTripDocument(tripId, attachmentId));
    setBusy(null);
    if (result.ok) { setMessage('moved'); await Promise.all([refreshLinks(), refreshReferences()]); return; }
    if (result.reason === 'busy') return;
    setMessage(result.reason === 'unreadable' ? 'unreadable' : result.reason === 'upload-failed' ? 'upload-failed' : 'link-failed');
  };

  const linkedIds = Array.isArray(links) ? links : [];
  const available = Array.isArray(references) ? references.filter((r) => !linkedIds.includes(r.id)) : [];

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t('travel.documentsLabel')}</Text>
      <Text style={[styles.hint, { color: textMuted }]}>{t('travel.docsHint')}</Text>

      {links === undefined && <Text style={{ color: textMuted }}>{t('travel.docsLoading')}</Text>}
      {links === null && (
        <>
          <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.docsLoadFailed')}</Text>
          <Button label={t('travel.docsRetry')} variant="secondary" onPress={load} />
        </>
      )}
      {Array.isArray(links) && links.length === 0 && <Text style={{ color: textMuted }}>{t('travel.docsNone')}</Text>}
      {linkedIds.map((documentId) => (
        <View key={documentId} style={[styles.row, { borderColor, backgroundColor: surface }]}>
          <Text style={styles.rowText} numberOfLines={2}>{nameOf(documentId) ?? t('travel.docsLinkedUnknown')}</Text>
          <Button
            label={t('travel.docsUnlink')}
            variant="secondary"
            disabled={busy !== null}
            accessibilityHint={t('travel.docsUnlinkHint')}
            onPress={() => unlink(documentId)}
          />
        </View>
      ))}

      <View style={styles.actions}>
        <Button label={t('travel.docsLink')} variant="secondary" disabled={busy !== null || links === undefined} style={styles.action} onPress={() => { setMessage(null); setPickerOpen(true); }} />
        <Button label={busy === 'add-file' ? t('travel.docsUploading') : t('travel.docsAddFile')} variant="secondary" disabled={busy !== null} style={styles.action} onPress={addFile} />
      </View>

      {message && (
        <Text accessibilityRole="alert" style={{ color: message === 'moved' ? undefined : danger }}>
          {t(`travel.docsMessages.${message}`)}
        </Text>
      )}

      {legacy.length > 0 && (
        <View style={styles.legacy}>
          <Text style={styles.label}>{t('travel.legacyLabel', { count: legacy.length })}</Text>
          <Text style={[styles.hint, { color: textMuted }]}>{t('travel.legacyHint')}</Text>
          {legacy.map((attachment) => (
            <View key={attachment.id} style={[styles.row, { borderColor, backgroundColor: surface }]}>
              <Text style={styles.rowText} numberOfLines={2}>{attachment.name}</Text>
              <Button
                label={busy === `legacy:${attachment.id}` ? t('travel.legacyMoving') : t('travel.legacyMove')}
                variant="secondary"
                disabled={busy !== null}
                onPress={() => moveLegacy(attachment.id)}
              />
            </View>
          ))}
        </View>
      )}

      <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
        <Pressable accessible={false} style={styles.backdrop} onPress={() => setPickerOpen(false)}>
          <Pressable accessible={false} style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.label}>{t('travel.docsPickerTitle')}</Text>
            {references === undefined && <Text style={{ color: textMuted }}>{t('travel.docsLoading')}</Text>}
            {references === null && (
              <>
                <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.docsPickerLoadFailed')}</Text>
                <Button label={t('travel.docsRetry')} variant="secondary" onPress={refreshReferences} />
              </>
            )}
            {Array.isArray(references) && available.length === 0 && (
              <Text style={{ color: textMuted }}>{t(references.length === 0 ? 'travel.docsPickerEmpty' : 'travel.docsPickerAllLinked')}</Text>
            )}
            {available.length > 0 && (
              <ScrollView style={styles.list}>
                {available.map((reference) => (
                  <Pressable
                    key={reference.id}
                    accessibilityRole="button"
                    accessibilityLabel={reference.originalName}
                    style={[styles.option, { borderColor, backgroundColor: surface }]}
                    disabled={busy !== null}
                    onPress={() => link(reference.id)}
                  >
                    <Text numberOfLines={2}>{reference.originalName}</Text>
                    <Text style={[styles.hint, { color: textMuted }]}>{formatDate(reference.createdAt)}</Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            <Button label={t('warranties.cancel')} variant="secondary" onPress={() => setPickerOpen(false)} />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, backgroundColor: 'transparent' },
  label: { fontWeight: '700', fontSize: 15 },
  hint: { fontSize: 12, lineHeight: 17 },
  row: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  rowText: { fontSize: 15 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  action: { flexGrow: 1 },
  legacy: { gap: 8, marginTop: 8, backgroundColor: 'transparent' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { maxHeight: '80%', borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 12 },
  list: { flexGrow: 0 },
  option: { minHeight: 44, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, gap: 2 },
});
