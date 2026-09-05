import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Pressable, ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useTripsStore } from "@/store/useTripsStore";

export default function TripDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const accentTints = useAccentTints();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");
  const warning = useThemeColor({}, "warning");

  const trip = useTripsStore((s) => s.trips.find((tr) => tr.id === id));
  const updateTrip = useTripsStore((s) => s.updateTrip);
  const removeTrip = useTripsStore((s) => s.removeTrip);
  const allParticipants = useTripsStore((s) => s.participants);
  const participants = useMemo(
    () => allParticipants.filter((p) => p.tripId === id),
    [allParticipants, id]
  );
  const myUserId = useTripsStore((s) => s.myUserId);
  const inviteParticipant = useTripsStore((s) => s.inviteParticipant);
  const removeParticipant = useTripsStore((s) => s.removeParticipant);
  const fetchParticipants = useTripsStore((s) => s.fetchParticipants);

  useEffect(() => {
    if (id) fetchParticipants(id);
  }, [id]);

  const [name, setName] = useState(trip?.name ?? "");
  const [startDate, setStartDate] = useState(trip?.startDate ?? "");
  const [endDate, setEndDate] = useState(trip?.endDate ?? "");
  const [budget, setBudget] = useState(trip?.budget?.toString() ?? "");
  const [showEdit, setShowEdit] = useState(false);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isInviting, setIsInviting] = useState(false);

  if (!trip) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t("travel.emptyState")}</Text>
      </View>
    );
  }

  const isOwner = participants.every((p) => p.ownerId === myUserId) || participants.length === 0
    ? true // hvis ingen deltagere-data endnu, antag ejer (dækkes af RLS uanset)
    : participants[0].ownerId === myUserId;

  const canSave = name.trim().length > 0 && startDate.length > 0 && endDate.length > 0;

  const save = () => {
    updateTrip(trip.id, {
      name: name.trim(),
      startDate,
      endDate,
      budget:
        budget.trim().length > 0 && !isNaN(parseFloat(budget)) ? parseFloat(budget) : null,
    });
    setShowEdit(false);
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(t("travel.deleteConfirmTitle"), t("travel.deleteConfirmMessage"), [
      { text: t("warranties.cancel"), style: "cancel" },
      {
        text: t("warranties.delete"),
        style: "destructive",
        onPress: () => {
          removeTrip(trip.id);
          router.back();
        },
      },
    ]);
  };

  const sendInvite = async () => {
    setInviteError(null);
    setIsInviting(true);
    const { error } = await inviteParticipant(trip.id, inviteEmail);
    setIsInviting(false);

    if (error === 'no_account_found') {
      setInviteError(t('travel.inviteNoAccountError'));
    } else if (error === 'cannot_invite_self') {
      setInviteError(t('travel.inviteSelfError'));
    } else if (error === 'trip_not_found') {
      setInviteError(t('travel.inviteTripNotFoundError'));
    } else if (error) {
      setInviteError(error);
    } else {
      setInviteEmail("");
      setShowInvite(false);
    }
  };

  const confirmRemoveParticipant = (userId: string, email: string) => {
    Alert.alert(t('travel.removeParticipantTitle'), t('travel.removeParticipantMessage', { email }), [
      { text: t('warranties.cancel'), style: 'cancel' },
      { text: t('travel.removeParticipant'), style: 'destructive', onPress: () => removeParticipant(trip.id, userId) },
    ]);
  };

  const statusColor = (status: string) => {
    if (status === 'accepted') return accentTints.accent;
    if (status === 'declined') return danger;
    return warning;
  };

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: trip.name,
          headerRight: () => (
            <Pressable onPress={() => setShowEdit(true)} style={styles.editButton}>
              <SymbolView
                name={{ ios: "pencil", android: "edit", web: "edit" }}
                size={20}
                tintColor={textMuted}
              />
              <Text style={{ color: textMuted }}>{t("warranties.edit")}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.summaryCard}>
        <Text style={styles.dates}>
          {trip.startDate} → {trip.endDate}
        </Text>
        {trip.budget !== null && (
          <Text style={{ color: textMuted }}>
            {t("travel.ofBudget", { budget: trip.budget.toFixed(2) })}
          </Text>
        )}
      </Card>

      <Button
        label={t("travel.expensesLabel")}
        onPress={() => router.push(`/travel/${trip.id}/expenses`)}
      />
      <Button
        label={t("travel.packingLabel")}
        variant="secondary"
        onPress={() => router.push(`/travel/${trip.id}/packing`)}
      />

      <View style={[styles.kicker, { backgroundColor: accentTints.accentSoft }]}>
        <SymbolView name={{ ios: 'person.2.fill', android: 'group', web: 'group' }} size={12} tintColor={accentTints.accent} />
        <Text style={[styles.kickerText, { color: accentTints.accent }]}>{t('travel.participantsLabel')}</Text>
      </View>

      {participants.length === 0 ? (
        <Text style={{ color: textMuted, fontSize: 13 }}>{t('travel.noParticipantsYet')}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {participants.map((p) => (
            <Pressable
              key={p.userId}
              onLongPress={isOwner ? () => confirmRemoveParticipant(p.userId, p.invitedEmail) : undefined}
            >
              <Card style={[styles.participantRow, { borderColor: accentTints.accentSoft }]}>
                <View style={[styles.participantIconCircle, { backgroundColor: statusColor(p.status) }]}>
                  <SymbolView name={{ ios: 'person.fill', android: 'person', web: 'person' }} size={14} tintColor="#FFFFFF" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.participantEmail}>{p.invitedEmail}</Text>
                  <Text style={{ color: statusColor(p.status), fontSize: 11, fontWeight: '700' }}>
                    {t(`travel.status.${p.status}`)}
                  </Text>
                </View>
              </Card>
            </Pressable>
          ))}
        </View>
      )}

      {isOwner && (
        <Pressable style={[styles.inviteButton, { borderColor: accentTints.accent }]} onPress={() => setShowInvite(true)}>
          <SymbolView name={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }} size={16} tintColor={accentTints.accent} />
          <Text style={[styles.inviteButtonText, { color: accentTints.accent }]}>{t('travel.inviteButton')}</Text>
        </Pressable>
      )}

      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowEdit(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView>
              <Card style={sharedStyles.card}>
                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                  value={name}
                  onChangeText={setName}
                />

                <Text style={sharedStyles.fieldLabel}>{t("travel.startDateLabel")}</Text>
                <DatePickerField value={startDate} onChange={setStartDate} />

                <Text style={sharedStyles.fieldLabel}>{t("travel.endDateLabel")}</Text>
                <DatePickerField value={endDate} onChange={setEndDate} />

                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                  placeholder={t("travel.budgetPlaceholder")}
                  placeholderTextColor={borderColor}
                  keyboardType="decimal-pad"
                  value={budget}
                  onChangeText={setBudget}
                />
              </Card>

              <Button label={t("travel.save")} disabled={!canSave} onPress={save} />
              <Button label={t("warranties.delete")} variant="danger" onPress={confirmDelete} />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showInvite} animationType="slide" transparent onRequestClose={() => setShowInvite(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowInvite(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.kicker, { backgroundColor: accentTints.accentSoft }]}>
              <Text style={[styles.kickerText, { color: accentTints.accent }]}>{t('travel.inviteButton')}</Text>
            </View>
            <Text style={{ color: textMuted, fontSize: 13, marginBottom: 4 }}>{t('travel.inviteHint')}</Text>
            <TextInput
              style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
              placeholder={t('travel.inviteEmailPlaceholder')}
              placeholderTextColor={borderColor}
              autoCapitalize="none"
              keyboardType="email-address"
              value={inviteEmail}
              onChangeText={setInviteEmail}
            />
            {inviteError && <Text style={{ color: danger, fontSize: 13 }}>{inviteError}</Text>}
            <Button
              label={isInviting ? t('travel.sendingInvite') : t('travel.sendInvite')}
              disabled={inviteEmail.trim().length === 0 || isInviting}
              onPress={sendInvite}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  summaryCard: { alignItems: "center" as const, gap: 4 },
  dates: { fontWeight: "700" as const },
  editButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginRight: 8,
  },
  kicker: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 5, alignSelf: 'flex-start' as const, borderRadius: 20, paddingVertical: 5, paddingHorizontal: 10, marginTop: 8 },
  kickerText: { fontSize: 11, fontWeight: '800' as const, textTransform: 'uppercase' as const, letterSpacing: 0.4 },
  participantRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  participantIconCircle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center' as const, justifyContent: 'center' as const },
  participantEmail: { fontWeight: '700' as const, fontSize: 14 },
  inviteButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 6,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 12,
  },
  inviteButtonText: { fontWeight: '700' as const, fontSize: 14 },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end" as const,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    maxHeight: "85%" as const,
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
};