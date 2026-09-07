import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
} from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useCareerStore } from "@/store/useCareerStore";
import { ApplicationStatus } from "@/types/career";

const STATUSES: ApplicationStatus[] = [
  "applied",
  "interview",
  "offer",
  "rejected",
];

export default function ApplicationDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");

  const application = useCareerStore((s) =>
    s.applications.find((a) => a.id === id),
  );
  const updateApplication = useCareerStore((s) => s.updateApplication);
  const removeApplication = useCareerStore((s) => s.removeApplication);

  const [company, setCompany] = useState(application?.company ?? "");
  const [position, setPosition] = useState(application?.position ?? "");
  const [status, setStatus] = useState<ApplicationStatus>(
    application?.status ?? "applied",
  );
  const [appliedDate, setAppliedDate] = useState(
    application?.appliedDate ?? "",
  );
  const [link, setLink] = useState(application?.link ?? "");
  const [notes, setNotes] = useState(application?.notes ?? "");
  const [showEdit, setShowEdit] = useState(false);

  if (!application) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t("career.emptyState")}</Text>
      </View>
    );
  }

  const canSave = company.trim().length > 0 && position.trim().length > 0;

  const save = () => {
    updateApplication(application.id, {
      company: company.trim(),
      position: position.trim(),
      status,
      appliedDate,
      link: link.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    setShowEdit(false);
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(
      t("career.deleteConfirmTitle"),
      t("career.deleteConfirmMessage"),
      [
        { text: t("warranties.cancel"), style: "cancel" },
        {
          text: t("career.delete"),
          style: "destructive",
          onPress: () => {
            removeApplication(application.id);
            router.back();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={{ backgroundColor }}
      contentContainerStyle={sharedStyles.formContainerScroll}
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen
        options={{
          title: application.position,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              onPress={() => setShowEdit(true)}
              style={styles.editButton}
            >
              <SymbolView
                name={{ ios: "pencil", android: "edit", web: "edit" }}
                size={20}
                tintColor={textMuted}
              />
              <Text style={{ color: textMuted }}>{t("career.edit")}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.summaryCard}>
        <Text style={styles.company}>{application.company}</Text>
        <Text style={{ color: textMuted }}>{application.appliedDate}</Text>
        <Text style={[styles.statusText, { color: tint }]}>
          {t(`career.status.${application.status}`)}
        </Text>
      </Card>

      {application.link && (
        <Button
          label={application.link}
          variant="secondary"
          onPress={() => Linking.openURL(application.link!)}
        />
      )}

      {application.notes && (
        <Card>
          <Text>{application.notes}</Text>
        </Card>
      )}

      <Modal
        visible={showEdit}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEdit(false)}
      >
        <Pressable
          accessible={false}
          style={styles.modalBackdrop}
          onPress={() => setShowEdit(false)}
        >
          <Pressable
            accessible={false}
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <ScrollView>
              <Card style={sharedStyles.card}>
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  placeholder={t("career.companyPlaceholder")}
                  placeholderTextColor={borderColor}
                  value={company}
                  onChangeText={setCompany}
                />
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  placeholder={t("career.positionPlaceholder")}
                  placeholderTextColor={borderColor}
                  value={position}
                  onChangeText={setPosition}
                />

                <Text style={sharedStyles.fieldLabel}>
                  {t("career.appliedDateLabel")}
                </Text>
                <DatePickerField
                  value={appliedDate}
                  onChange={setAppliedDate}
                />

                <Text style={sharedStyles.fieldLabel}>
                  {t("career.statusLabel")}
                </Text>
                <View style={sharedStyles.chipRow}>
                  {STATUSES.map((s) => (
                    <Chip
                      key={s}
                      label={t(`career.status.${s}`)}
                      active={status === s}
                      onPress={() => setStatus(s)}
                    />
                  ))}
                </View>

                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  placeholder={t("career.linkPlaceholder")}
                  placeholderTextColor={borderColor}
                  value={link}
                  onChangeText={setLink}
                  autoCapitalize="none"
                />
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  placeholder={t("career.notesPlaceholder")}
                  placeholderTextColor={borderColor}
                  value={notes}
                  onChangeText={setNotes}
                />
              </Card>

              <Button
                label={t("career.save")}
                disabled={!canSave}
                onPress={save}
              />
              <Button
                label={t("career.delete")}
                variant="danger"
                onPress={confirmDelete}
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  summaryCard: { alignItems: "center" as const, gap: 4 },
  company: { fontWeight: "700" as const, fontSize: 16 },
  statusText: { fontWeight: "700" as const, marginTop: 4 },
  editButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginRight: 8,
  },
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