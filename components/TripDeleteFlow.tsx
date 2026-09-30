import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet } from 'react-native';

import Button from '@/components/Button';
import { Text, useThemeColor, View } from '@/components/Themed';
import { useTripsStore } from '@/store/useTripsStore';
import { fetchTripDeletionPreview, type TripDeletionPreview } from '@/utils/trip/tripRemote';
import { settleTripWrites } from '@/utils/trip/tripWriteLane';

/**
 * Deleting a trip (APP-058): look first, then delete.
 *
 * The preview is the SERVER's count of what the trip owns — expenses and packing
 * items of every author, participants and invitations, and links to documents —
 * and it decides who may delete: only the owner is offered the button. If the
 * preview cannot be obtained the flow says so and offers a retry; it never assumes
 * zero, and it never lets the user confirm something they were not shown.
 *
 * Linked standalone Documents are never deleted with the trip; the copy says so.
 *
 * Deleting also clears what this DEVICE holds for the trip, and that can be more than
 * the server knows: a write that failed or never left the phone leaves an expense or a
 * packing item only here. So the device's own counts — expenses, packing items,
 * invitations shown, legacy files — are always listed separately from the server's, as
 * this device's, and anything the device holds beyond the server's count is called out.
 * "0 expenses" is never shown next to a local expense that is about to be deleted.
 */

type Phase =
  | { kind: 'loading' }
  /** `changed`: the counts were refreshed because the trip changed after the user last saw them. */
  | { kind: 'preview'; preview: TripDeletionPreview; changed?: boolean }
  | { kind: 'preview-failed' }
  | { kind: 'deleting'; preview: TripDeletionPreview }
  | { kind: 'delete-failed'; preview: TripDeletionPreview };

type Props = {
  tripId: string;
  visible: boolean;
  onClose: () => void;
  /** Called once the trip is gone from the server and from this device. */
  onDeleted: () => void;
};

export default function TripDeleteFlow({ tripId, visible, onClose, onDeleted }: Props) {
  const { t } = useTranslation();
  const borderColor = useThemeColor({}, 'border');
  const backgroundColor = useThemeColor({}, 'background');
  const textMuted = useThemeColor({}, 'textMuted');
  const danger = useThemeColor({}, 'danger');

  const legacyCount = useTripsStore((s) => s.trips.find((tr) => tr.id === tripId)?.documents.length ?? 0);
  const localExpenses = useTripsStore((s) => s.expenses.filter((e) => e.tripId === tripId).length);
  const localPacking = useTripsStore((s) => s.packingItems.filter((p) => p.tripId === tripId).length);
  const localParticipants = useTripsStore((s) => s.participants.filter((p) => p.tripId === tripId).length);
  const deleteTrip = useTripsStore((s) => s.deleteTrip);
  const removeTripFromDevice = useTripsStore((s) => s.removeTripFromDevice);

  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });

  const load = useCallback(() => {
    let cancelled = false;
    setPhase({ kind: 'loading' });
    // Behind any write of this trip still in flight: a preview taken while the trip's own
    // creation is on its way would say "the server has no such trip" about a trip it is
    // about to have.
    settleTripWrites(tripId)
      .then(() => fetchTripDeletionPreview(tripId))
      .then((result) => {
        if (cancelled) return;
        setPhase(result.ok ? { kind: 'preview', preview: result.preview } : { kind: 'preview-failed' });
      })
      .catch(() => { if (!cancelled) setPhase({ kind: 'preview-failed' }); });
    return () => { cancelled = true; };
  }, [tripId]);

  useEffect(() => (visible ? load() : undefined), [visible, load]);

  const confirm = async (preview: Extract<TripDeletionPreview, { status: 'ok' }>) => {
    setPhase({ kind: 'deleting', preview });
    // The server deletes only what the user was shown: it is given those very counts.
    const result = await deleteTrip(tripId, {
      expenses: preview.expenses,
      packingItems: preview.packingItems,
      participants: preview.participants,
      documents: preview.documents,
    });
    if (result.ok) {
      onDeleted();
      return;
    }
    if (result.reason === 'changed') {
      // Something was added in between. Nothing was deleted. Show what is there now and wait
      // for a NEW decision — a changed preview is never confirmed on the user's behalf.
      setPhase({ kind: 'preview', preview: { status: 'ok', ...result.counts }, changed: true });
      return;
    }
    if (result.reason === 'not-owner') {
      setPhase({ kind: 'preview', preview: { status: 'not-owner' } });
      return;
    }
    setPhase({ kind: 'delete-failed', preview });
  };

  const removeFromDevice = () => {
    removeTripFromDevice(tripId);
    onDeleted();
  };

  /** What this device will lose, in this device's own numbers — never the server's. */
  const deviceSection = (server: TripDeletionPreview) => {
    if (!hasDeviceData) return null;
    const beyondServer = server.status === 'ok'
      ? localExpenses > server.expenses || localPacking > server.packingItems
      : localExpenses + localPacking > 0;
    return (
      <View style={styles.list} accessibilityRole="summary">
        <Text style={styles.subheading}>{t('travel.deleteDeviceHeading')}</Text>
        {localExpenses > 0 && <Text>{t('travel.deleteDeviceExpenses', { count: localExpenses })}</Text>}
        {localPacking > 0 && <Text>{t('travel.deleteDevicePacking', { count: localPacking })}</Text>}
        {localParticipants > 0 && <Text>{t('travel.deleteDeviceParticipants', { count: localParticipants })}</Text>}
        {legacyCount > 0 && <Text>{t('travel.deletePreviewOnDevice', { count: legacyCount })}</Text>}
        {beyondServer && <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.deleteDeviceUnsynced')}</Text>}
      </View>
    );
  };

  const busy = phase.kind === 'deleting';
  const hasDeviceData = localExpenses + localPacking + localParticipants + legacyCount > 0;
  const shown = phase.kind === 'preview' || phase.kind === 'deleting' || phase.kind === 'delete-failed' ? phase.preview : null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={busy ? () => undefined : onClose}>
      <Pressable accessible={false} style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable
          accessible={false}
          style={[styles.card, { backgroundColor, borderColor }]}
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView contentContainerStyle={styles.content}>
            <Text style={styles.title}>{t('travel.deleteConfirmTitle')}</Text>

            {phase.kind === 'loading' && <Text style={{ color: textMuted }}>{t('travel.deletePreviewLoading')}</Text>}

            {phase.kind === 'preview-failed' && (
              <>
                <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.deletePreviewFailed')}</Text>
                <Button label={t('travel.deletePreviewRetry')} variant="secondary" onPress={load} />
              </>
            )}

            {phase.kind === 'preview' && phase.changed && (
              <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.deleteChanged')}</Text>
            )}

            {shown?.status === 'ok' && (
              <>
                <Text>{t('travel.deletePreviewIntro')}</Text>
                <Text style={styles.subheading}>{t('travel.deleteServerHeading')}</Text>
                <View style={styles.list}>
                  <Text>{t('travel.deletePreviewExpenses', { count: shown.expenses })}</Text>
                  <Text>{t('travel.deletePreviewPacking', { count: shown.packingItems })}</Text>
                  <Text>{t('travel.deletePreviewParticipants', { count: shown.participants })}</Text>
                  <Text>{t('travel.deletePreviewDocumentLinks', { count: shown.documents })}</Text>
                </View>
                <Text style={styles.retained}>{t('travel.deletePreviewDocumentsKept')}</Text>
                {deviceSection(shown)}
                <Text style={{ color: textMuted }}>{t('travel.deleteConfirmMessage')}</Text>
              </>
            )}

            {shown?.status === 'not-owner' && (
              <Text accessibilityRole="alert">{t('travel.deleteNotOwner')}</Text>
            )}

            {shown?.status === 'not-found' && (
              <>
                <Text>{t('travel.deleteNotOnServer')}</Text>
                {deviceSection(shown)}
              </>
            )}

            {phase.kind === 'delete-failed' && (
              <Text accessibilityRole="alert" style={{ color: danger }}>{t('travel.deleteFailed')}</Text>
            )}

            {shown?.status === 'ok' && (
              <Button
                label={busy ? t('travel.deleting') : phase.kind === 'delete-failed' ? t('travel.deleteRetry') : t('warranties.delete')}
                variant="danger"
                disabled={busy}
                onPress={() => confirm(shown)}
              />
            )}
            {shown?.status === 'not-found' && (
              <Button label={t('travel.removeFromDevice')} variant="danger" onPress={removeFromDevice} />
            )}
            <Button label={t('warranties.cancel')} variant="secondary" disabled={busy} onPress={onClose} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  card: { maxHeight: '85%', borderTopWidth: 1, borderRadius: 20, padding: 16, paddingBottom: 32 },
  content: { gap: 12 },
  title: { fontSize: 18, fontWeight: '800' },
  list: { gap: 4, backgroundColor: 'transparent' },
  retained: { fontWeight: '700' },
  subheading: { fontWeight: '700', fontSize: 13, opacity: 0.7 },
});
