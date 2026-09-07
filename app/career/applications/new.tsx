import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useCareerStore } from "@/store/useCareerStore";
import { ApplicationStatus } from "@/types/career";
import { todayIso } from "@/utils/shared/localDate";

const STATUSES: ApplicationStatus[] = [
  "applied",
  "interview",
  "offer",
  "rejected",
];

export default function NewApplicationScreen() {
  const { t } = useTranslation();
  const addApplication = useCareerStore((s) => s.addApplication);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");

  const [company, setCompany] = useState("");
  const [position, setPosition] = useState("");
  const [status, setStatus] = useState<ApplicationStatus>("applied");
  const today = todayIso();
  const [appliedDate, setAppliedDate] = useState(today);
  const [link, setLink] = useState("");
  const [notes, setNotes] = useState("");

  const canSave = company.trim().length > 0 && position.trim().length > 0;

  const save = () => {
    addApplication({
      company: company.trim(),
      position: position.trim(),
      status,
      appliedDate,
      link: link.trim() || undefined,
      notes: notes.trim() || undefined,
    });
    router.back();
  };

  return (
    <View style={sharedStyles.formContainer}>
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
        <DatePickerField value={appliedDate} onChange={setAppliedDate} />

        <Text style={sharedStyles.fieldLabel}>{t("career.statusLabel")}</Text>
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

      <Button label={t("career.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}
