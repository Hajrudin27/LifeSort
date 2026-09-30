import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import { Text, useThemeColor, View } from '@/components/Themed';
import { fetchDocumentReferences, type DocumentReference } from '@/core/documents/documentReferences';

/**
 * A warranty's receipt, as a reference to a document the user already keeps
 * (APP-057).
 *
 * The warranty stores an id and nothing else. The list of the user's documents is
 * read through the narrow reference boundary, held in this component's memory
 * only, and never written into the warranty: no filename, path or URL leaves here.
 * Uploading is not offered — that is the Documents module's, and linking to it
 * does not make it reachable.
 *
 * Every state is said plainly: loading, a failed read (never shown as "no
 * documents"), no documents at all, and a linked document that no longer exists.
 * Without `onChange` the field only shows what is linked.
 */

type Props = {
  value?: string;
  onChange?: (receiptDocumentId: string | undefined) => void;
};

/** undefined while loading, null when the read failed. */
type References = DocumentReference[] | null | undefined;

export default function WarrantyReceiptField({ value, onChange }: Props) {
  const { t, i18n } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const surface = useThemeColor({}, 'surface');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');

  const [references, setReferences] = useState<References>(undefined);
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setReferences(undefined);
    fetchDocumentReferences()
      .then((result) => { if (!cancelled) setReferences(result); })
      .catch(() => { if (!cancelled) setReferences(null); });
    return () => { cancelled = true; };
  }, []);

  // Shown read-only with nothing linked, there is nothing to name and nothing to fetch.
  const needsReferences = onChange !== undefined || value !== undefined;
  useEffect(() => (needsReferences ? load() : undefined), [load, needsReferences]);

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

  const linked = value === undefined ? undefined : references?.find((reference) => reference.id === value);
  const linkedText =
    value === undefined
      ? t('warranties.receiptNone')
      : linked
        ? linked.originalName
        : Array.isArray(references)
          ? t('warranties.receiptUnavailable')
          : t('warranties.receiptLinked');

  const choose = (id: string) => {
    onChange?.(id);
    setPickerOpen(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{t('warranties.receiptLabel')}</Text>
      <View style={[styles.linkedRow, { borderColor, backgroundColor: surface }]}>
        <Text style={styles.linkedText} numberOfLines={2}>{linkedText}</Text>
        {linked && <Text style={[styles.meta, { color: textMuted }]}>{formatDate(linked.createdAt)}</Text>}
      </View>

      {onChange && (
        <>
          <Text style={[styles.meta, { color: textMuted }]}>{t('warranties.receiptHint')}</Text>
          <View style={styles.actions}>
            <Button
              label={value === undefined ? t('warranties.receiptChoose') : t('warranties.receiptChange')}
              variant="secondary"
              style={styles.action}
              onPress={() => setPickerOpen(true)}
            />
            {value !== undefined && (
              <Button
                label={t('warranties.receiptRemove')}
                variant="secondary"
                style={styles.action}
                onPress={() => onChange(undefined)}
              />
            )}
          </View>

          <Modal visible={pickerOpen} animationType="slide" transparent onRequestClose={() => setPickerOpen(false)}>
            <Pressable accessible={false} style={styles.backdrop} onPress={() => setPickerOpen(false)}>
              <Pressable
                accessible={false}
                style={[styles.modalCard, { backgroundColor, borderColor }]}
                onPress={(e) => e.stopPropagation()}
              >
                <Text style={styles.modalTitle}>{t('warranties.receiptPickerTitle')}</Text>
                {references === undefined && (
                  <Text style={{ color: textMuted }}>{t('warranties.receiptLoading')}</Text>
                )}
                {references === null && (
                  <>
                    <Text accessibilityRole="alert" style={{ color: textMuted }}>{t('warranties.receiptLoadFailed')}</Text>
                    <Button label={t('warranties.receiptRetry')} variant="secondary" onPress={load} />
                  </>
                )}
                {Array.isArray(references) && references.length === 0 && (
                  <Text style={{ color: textMuted }}>{t('warranties.receiptEmpty')}</Text>
                )}
                {Array.isArray(references) && references.length > 0 && (
                  <ScrollView style={styles.list}>
                    {references.map((reference) => (
                      <Pressable
                        key={reference.id}
                        accessibilityRole="button"
                        accessibilityLabel={reference.originalName}
                        accessibilityState={{ selected: reference.id === value }}
                        style={[styles.option, { borderColor, backgroundColor: surface }]}
                        onPress={() => choose(reference.id)}
                      >
                        <Text style={styles.linkedText} numberOfLines={2}>{reference.originalName}</Text>
                        <Text style={[styles.meta, { color: textMuted }]}>{formatDate(reference.createdAt)}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
                <Button label={t('warranties.cancel')} variant="secondary" onPress={() => setPickerOpen(false)} />
              </Pressable>
            </Pressable>
          </Modal>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, backgroundColor: 'transparent' },
  label: { fontWeight: '600' },
  linkedRow: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 2 },
  linkedText: { fontSize: 15 },
  meta: { fontSize: 12, lineHeight: 17 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, backgroundColor: 'transparent' },
  action: { flexGrow: 1 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  modalCard: { maxHeight: '80%', borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32, gap: 12 },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  list: { flexGrow: 0 },
  option: { minHeight: 44, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8, gap: 2 },
});
