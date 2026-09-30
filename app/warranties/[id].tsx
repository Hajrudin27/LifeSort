import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Pressable, ScrollView, TextInput } from "react-native";

import AttachmentList from "@/components/AttachmentList";
import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import WarrantyReceiptField from "@/components/WarrantyReceiptField";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useWarrantiesStore } from "@/store/useWarrantiesStore";
import { WarrantyType } from "@/types/warranty";
import { daysUntil } from "@/utils/shared/dateDays";
import { warrantyDateProblem } from "@/utils/warranty/warrantyDomain";

const TYPES: WarrantyType[] = [
  "insurance",
  "rental",
  "warranty",
  "receipt",
  "other",
];

export default function WarrantyDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const textMuted = useThemeColor({}, "textMuted");
  const danger = useThemeColor({}, "danger");
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;

  const warranty = useWarrantiesStore((s) =>
    s.warranties.find((w) => w.id === id),
  );
  const updateWarranty = useWarrantiesStore((s) => s.updateWarranty);
  const removeWarranty = useWarrantiesStore((s) => s.removeWarranty);
  const renewWarranty = useWarrantiesStore((s) => s.renewWarranty);
  const addAttachment = useWarrantiesStore((s) => s.addAttachment);
  const removeAttachment = useWarrantiesStore((s) => s.removeAttachment);

  const [name, setName] = useState(warranty?.name ?? "");
  const [type, setType] = useState<WarrantyType>(warranty?.type ?? "other");
  const [expiryDate, setExpiryDate] = useState(warranty?.expiryDate ?? "");
  const [notes, setNotes] = useState(warranty?.notes ?? "");
  const [seller, setSeller] = useState(warranty?.seller ?? "");
  // "" = not recorded. Legacy warranties have none, and none is invented.
  const [purchaseDate, setPurchaseDate] = useState(warranty?.purchaseDate ?? "");
  const [receiptDocumentId, setReceiptDocumentId] = useState<string | undefined>(warranty?.receiptDocumentId);
  const [showEdit, setShowEdit] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);

  if (!warranty) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t("warranties.emptyState")}</Text>
      </View>
    );
  }

  const dateProblem = warrantyDateProblem({ expiryDate, purchaseDate: purchaseDate || undefined });
  const canSave = name.trim().length > 0 && dateProblem === null;
  const days = daysUntil(warranty.expiryDate);
  const isExpired = days < 0;

  const save = () => {
    const saved = updateWarranty(warranty.id, {
      name: name.trim(),
      type,
      expiryDate,
      notes: notes.trim() || undefined,
      purchaseDate: purchaseDate || undefined,
      seller: seller.trim() || undefined,
      receiptDocumentId,
    });
    if (!saved) {
      setSaveFailed(true);
      return;
    }
    setSaveFailed(false);
    setShowEdit(false);
    router.back();
  };

  const confirmDelete = () => {
    Alert.alert(
      t("warranties.deleteConfirmTitle"),
      t("warranties.deleteConfirmMessage"),
      [
        { text: t("warranties.cancel"), style: "cancel" },
        {
          text: t("warranties.delete"),
          style: "destructive",
          onPress: () => {
            removeWarranty(warranty.id);
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
          title: warranty.name,
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
              <Text style={{ color: textMuted }}>{t("warranties.edit")}</Text>
            </Pressable>
          ),
        }}
      />

      <Card style={styles.statusCard}>
        <Text style={[styles.daysText, { color: isExpired ? danger : textMuted }]}>
          {isExpired
            ? t("warranties.expired")
            : t("warranties.expiresIn", { days })}
        </Text>
        <Text style={{ color: textMuted }}>
          {t("warranties.expiryLabel")}: {warranty.expiryDate}
        </Text>
      </Card>

      <Card style={styles.detailsCard}>
        <Text style={sharedStyles.fieldLabel}>{t("warranties.sellerLabel")}</Text>
        <Text style={{ color: warranty.seller ? undefined : textMuted }}>
          {warranty.seller ?? t("warranties.notSet")}
        </Text>
        <Text style={sharedStyles.fieldLabel}>{t("warranties.purchaseDateLabel")}</Text>
        <Text style={{ color: warranty.purchaseDate ? undefined : textMuted }}>
          {warranty.purchaseDate ?? t("warranties.notSet")}
        </Text>
      </Card>

      <WarrantyReceiptField value={warranty.receiptDocumentId} />

      <Button
        label={t("warranties.renew")}
        variant="secondary"
        onPress={() => renewWarranty(warranty.id)}
      />

      {warranty.notes && (
        <Card>
          <Text>{warranty.notes}</Text>
        </Card>
      )}

      <Text style={sharedStyles.sectionLabel}>
        {t("warranties.attachmentsLabel")}
      </Text>
      <AttachmentList
        attachments={warranty.attachments}
        onAdd={(a) => addAttachment(warranty.id, a)}
        onRemove={(attachmentId) => removeAttachment(warranty.id, attachmentId)}
      />

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
                <Text style={sharedStyles.fieldLabel}>
                  {t("warranties.nameLabel")}
                </Text>
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  value={name}
                  onChangeText={setName}
                />

                <Text style={sharedStyles.fieldLabel}>
                  {t("warranties.sellerLabel")}
                </Text>
                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  placeholder={t("warranties.sellerPlaceholder")}
                  placeholderTextColor={borderColor}
                  value={seller}
                  onChangeText={setSeller}
                />

                <Text style={sharedStyles.fieldLabel}>
                  {t("warranties.purchaseDateLabel")}
                </Text>
                <DatePickerField value={purchaseDate} onChange={setPurchaseDate} yearsBack={30} yearsForward={0} />
                {purchaseDate !== "" && (
                  <Pressable
                    accessibilityRole="button"
                    style={styles.clearDate}
                    onPress={() => setPurchaseDate("")}
                  >
                    <Text style={{ color: tintColor }}>{t("warranties.clearDate")}</Text>
                  </Pressable>
                )}

                <Text style={sharedStyles.fieldLabel}>
                  {t("warranties.expiryLabel")}
                </Text>
                <DatePickerField value={expiryDate} onChange={setExpiryDate} />

                {dateProblem && (
                  <Text accessibilityRole="alert" style={{ color: danger }}>
                    {t(`warranties.dateProblems.${dateProblem}`)}
                  </Text>
                )}

                <Text style={sharedStyles.fieldLabel}>
                  {t("warranties.typeLabel")}
                </Text>
                <View style={sharedStyles.chipRow}>
                  {TYPES.map((ty) => (
                    <Chip
                      key={ty}
                      label={t(`warranties.types.${ty}`)}
                      active={type === ty}
                      onPress={() => setType(ty)}
                    />
                  ))}
                </View>

                <TextInput
                  style={[
                    sharedStyles.input,
                    { borderColor, backgroundColor: surface },
                  ]}
                  placeholder={t("warranties.notesPlaceholder")}
                  placeholderTextColor={borderColor}
                  value={notes}
                  onChangeText={setNotes}
                />

                <WarrantyReceiptField value={receiptDocumentId} onChange={setReceiptDocumentId} />
              </Card>

              {saveFailed && (
                <Text accessibilityRole="alert" style={{ color: danger }}>
                  {t("warranties.saveFailed")}
                </Text>
              )}

              <Button
                label={t("warranties.save")}
                disabled={!canSave}
                onPress={save}
              />
              <Button
                label={t("warranties.delete")}
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
  statusCard: { alignItems: "center" as const, gap: 4 },
  detailsCard: { gap: 4 },
  clearDate: { alignSelf: "flex-start" as const, minHeight: 34, justifyContent: "center" as const },
  daysText: { fontWeight: "700" as const, fontSize: 16 },
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