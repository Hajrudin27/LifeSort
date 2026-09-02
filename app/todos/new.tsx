import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import DatePickerField from "@/components/DatePickerField";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useCycleStore } from "@/store/useCycleStore";
import { useProfileStore } from "@/store/useProfileStore";
import { useTodoStore } from "@/store/useTodoStore";
import { TodoImportance } from "@/types/life";
import { getPhaseForDate } from "@/utils/cycle/cycleInsights";

const IMPORTANCE_LEVELS: TodoImportance[] = ["low", "medium", "high"];

export default function NewTodoScreen() {
  const { t } = useTranslation();
  const addTodo = useTodoStore((s) => s.addTodo);
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [importance, setImportance] = useState<TodoImportance>("medium");
  const [dueDate, setDueDate] = useState("");
  const [showDuePicker, setShowDuePicker] = useState(false);

  const gender = useProfileStore((s) => s.profile.gender);
  const cycles = useCycleStore((s) => s.cycles);
  const avgCycleLength = useCycleStore((s) => s.avgCycleLength);
  const lutealPhaseLength = useCycleStore((s) => s.lutealPhaseLength);

  const dueDatePhase =
    gender === "female" && showDuePicker && dueDate
      ? getPhaseForDate(dueDate, cycles, avgCycleLength, 5, lutealPhaseLength)
      : null;

  const canSave = title.trim().length > 0;

  const save = () => {
    addTodo({
      title: title.trim(),
      description: description.trim() || undefined,
      importance,
      dueDate: showDuePicker && dueDate ? dueDate : undefined,
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
          placeholder={t("todos.titlePlaceholder")}
          placeholderTextColor={borderColor}
          value={title}
          onChangeText={setTitle}
        />
        <TextInput
          style={[
            sharedStyles.input,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("todos.descriptionPlaceholder")}
          placeholderTextColor={borderColor}
          value={description}
          onChangeText={setDescription}
        />

        <Text style={sharedStyles.fieldLabel}>
          {t("todos.importanceLabel")}
        </Text>
        <View style={sharedStyles.chipRow}>
          {IMPORTANCE_LEVELS.map((level) => (
            <Chip
              key={level}
              label={t(`todos.importance.${level}`)}
              active={importance === level}
              onPress={() => setImportance(level)}
            />
          ))}
        </View>

        {showDuePicker ? (
          <>
            <Text style={sharedStyles.fieldLabel}>
              {t("todos.dueDateLabel")}
            </Text>
            <DatePickerField
              value={dueDate || new Date().toISOString().split("T")[0]}
              onChange={setDueDate}
            />
            {dueDatePhase === "menstrual" && (
              <Text style={{ color: textMuted, fontSize: 12, marginTop: 4 }}>
                {t("todos.dueDatePhaseHint")}
              </Text>
            )}
          </>
        ) : (
          <Pressable onPress={() => setShowDuePicker(true)}>
            <Text style={[styles.addLink, { color: textMuted }]}>
              + {t("todos.dueDateLabel")}
            </Text>
          </Pressable>
        )}
      </Card>

      <Button label={t("todos.save")} disabled={!canSave} onPress={save} />
    </View>
  );
}

const styles = {
  addLink: { fontSize: 13 },
};
