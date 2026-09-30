import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Pressable, ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import TripDeleteFlow from "@/components/TripDeleteFlow";
import TripDocumentsSection from "@/components/TripDocumentsSection";
import DatePickerField from "@/components/DatePickerField";
import Kicker from "@/components/Kicker";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useAuthStore } from "@/store/useAuthStore";
import { useTripsStore } from "@/store/useTripsStore";
import { MAX_TRIP_DESTINATION_LENGTH, normalizeDestination, tripProblem } from "@/utils/trip/tripDomain";

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
  const allParticipants = useTripsStore((s) => s.participants);
  const participants = useMemo(
    () => allParticipants.filter((p) => p.tripId === id),
    [allParticipants, id]
  );
  const sessionUserId = useAuthStore((s) => s.session?.user.id);
  const inviteParticipant = useTripsStore((s) => s.inviteParticipant);
  const isEmailVerified = useAuthStore((s) => s.isEmailVerified);
  const removeParticipant = useTripsStore((s) => s.removeParticipant);
  const fetchParticipants = useTripsStore((s) => s.fetchParticipants);

  useEffect(() => {
    if (id) fetchParticipants(id);
  }, [id]);

  const [name, setName] = useState(trip?.name ?? "");
  const [destination, setDestination] = useState(trip?.destination ?? "");
  const [saveFailed, setSaveFailed] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
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

  // Ownership is a positive fact or it is nothing (APP-058). The trip carries the owner
  // the server named (`trips.user_id`), and I am the owner only when that is me. A trip
  // whose owner is not known yet — still loading, the fetch failed, or it predates the
  // field — offers no owner-only control, and neither does one that is someone else's.
  // Missing or late participant data never makes anyone an owner. This only decides what
  // is SHOWN: the server still refuses every owner-only action to anyone else.
  const isOwner = !!sessionUserId && trip.ownerId === sessionUserId;

  // A trip from before destinations may stay without one; once it has one it stays.
  const problem = tripProblem(
    { destination, startDate, endDate },
    { destinationRequired: normalizeDestination(trip.destination) !== undefined },
  );
  const canSave = name.trim().length > 0 && problem === null;

  const save = () => {
    const saved = updateTrip(trip.id, {
      name: name.trim(),
      destination: destination.trim(),
      startDate,
      endDate,
      budget:
        budget.trim().length > 0 && !isNaN(parseFloat(budget)) ? parseFloat(budget) : null,
    });
    if (!saved) {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    setShowEdit(false);
    router.back();
  };

  const sendInvite = async () => {
    setInviteError(null);

    // En invitation forlader appen og lander i en fremmed indbakke, afsendt fra
    // en adresse afsenderen ikke har bevist at eje. Bekræftelsen først (APP-018).
    if (!isEmailVerified) {
      setInviteError(t('auth.verifyRequiredBody'));
      return;
    }

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
      setInviteError(t('auth.errorGeneric'));
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
            <Pressable accessibilityRole="button" onPress={() => setShowEdit(true)} style={styles.editButton}>
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
        <Text style={styles.destination}>{trip.destination ?? t("travel.destinationNotSet")}</Text>
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

      {isOwner && <TripDocumentsSection tripId={trip.id} />}

      <Kicker
        label={t('travel.participantsLabel')}
        color={accentTints.accent}
        backgroundColor={accentTints.accentSoft}
        icon={{ ios: 'person.2.fill', android: 'group', web: 'group' }}
        style={styles.kickerSpacing}
      />

      {participants.length === 0 ? (
        <Text style={{ color: textMuted, fontSize: 13 }}>{t('travel.noParticipantsYet')}</Text>
      ) : (
        <View style={{ gap: 8 }}>
          {participants.map((p) => (
            <Pressable
              accessibilityRole="button"
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
        <Pressable accessibilityRole="button" style={[styles.inviteButton, { borderColor: accentTints.accent }]} onPress={() => setShowInvite(true)}>
          <SymbolView name={{ ios: 'person.badge.plus', android: 'person_add', web: 'person_add' }} size={16} tintColor={accentTints.accent} />
          <Text style={[styles.inviteButtonText, { color: accentTints.accent }]}>{t('travel.inviteButton')}</Text>
        </Pressable>
      )}

      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <Pressable accessible={false} style={styles.modalBackdrop} onPress={() => setShowEdit(false)}>
          <Pressable accessible={false} style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <ScrollView>
              <Card style={sharedStyles.card}>
                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                  value={name}
                  onChangeText={setName}
                />

                <Text style={sharedStyles.fieldLabel}>{t("travel.destinationLabel")}</Text>
                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                  placeholder={t("travel.destinationPlaceholder")}
                  placeholderTextColor={borderColor}
                  accessibilityLabel={t("travel.destinationLabel")}
                  maxLength={MAX_TRIP_DESTINATION_LENGTH}
                  value={destination}
                  onChangeText={setDestination}
                />

                <Text style={sharedStyles.fieldLabel}>{t("travel.startDateLabel")}</Text>
                <DatePickerField value={startDate} onChange={setStartDate} />

                <Text style={sharedStyles.fieldLabel}>{t("travel.endDateLabel")}</Text>
                <DatePickerField value={endDate} onChange={setEndDate} />

                {problem && (
                  <Text accessibilityRole="alert" style={{ color: danger }}>{t(`travel.problems.${problem}`)}</Text>
                )}

                <TextInput
                  style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
                  placeholder={t("travel.budgetPlaceholder")}
                  placeholderTextColor={borderColor}
                  keyboardType="decimal-pad"
                  value={budget}
                  onChangeText={setBudget}
                />
              </Card>

              {saveFailed && <Text accessibilityRole="alert" style={{ color: danger }}>{t("travel.saveFailed")}</Text>}
              <Button label={t("travel.save")} disabled={!canSave} onPress={save} />
              {isOwner && (
                <Button label={t("warranties.delete")} variant="danger" onPress={() => { setShowEdit(false); setShowDelete(true); }} />
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <TripDeleteFlow
        tripId={trip.id}
        visible={showDelete}
        onClose={() => setShowDelete(false)}
        onDeleted={() => { setShowDelete(false); router.back(); }}
      />

      <Modal visible={showInvite} animationType="slide" transparent onRequestClose={() => setShowInvite(false)}>
        <Pressable accessible={false} style={styles.modalBackdrop} onPress={() => setShowInvite(false)}>
          <Pressable accessible={false} style={[styles.modalCard, { backgroundColor, borderColor }]} onPress={(e) => e.stopPropagation()}>
            <Kicker
              label={t('travel.inviteButton')}
              color={accentTints.accent}
              backgroundColor={accentTints.accentSoft}
              style={styles.kickerSpacing}
            />
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
  kickerSpacing: { marginTop: 8 },
  summaryCard: { alignItems: "center" as const, gap: 4 },
  destination: { fontWeight: "800" as const, fontSize: 18, textAlign: "center" as const },
  dates: { fontWeight: "700" as const },
  editButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginRight: 8,
  },
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