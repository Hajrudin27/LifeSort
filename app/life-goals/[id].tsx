import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Modal, Pressable, ScrollView, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import DatePickerField from "@/components/DatePickerField";
import RingProgress from "@/components/RingProgress";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useLifeGoalsStore } from "@/store/useLifeGoalsStore";

export default function LifeGoalDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");

  const goal = useLifeGoalsStore((s) => s.goals.find((g) => g.id === id));
  const updateGoal = useLifeGoalsStore((s) => s.updateGoal);
  const removeGoal = useLifeGoalsStore((s) => s.removeGoal);
  const addSubGoal = useLifeGoalsStore((s) => s.addSubGoal);
  const toggleSubGoal = useLifeGoalsStore((s) => s.toggleSubGoal);
  const removeSubGoal = useLifeGoalsStore((s) => s.removeSubGoal);

  const [title, setTitle] = useState(goal?.title ?? "");
  const [description, setDescription] = useState(goal?.description ?? "");
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [newSubGoal, setNewSubGoal] = useState("");
  const [showEdit, setShowEdit] = useState(false);

  if (!goal) {
    return (
      <View style={sharedStyles.formContainer}>
        <Text>{t("lifeGoals.emptyState")}</Text>
      </View>
    );
  }

  const canSave = title.trim().length > 0;
  const done = goal.subGoals.filter((sg) => sg.completed).length;
  const total = goal.subGoals.length;
  const progress = total > 0 ? done / total : 0;

  const save = () => {
    updateGoal(goal.id, {
      title: title.trim(),
      description: description.trim() || undefined,
      deadline: deadline || undefined,
    });
    setShowEdit(false);
    router.back();
  };

  const addSub = () => {
    if (newSubGoal.trim().length === 0) return;
    addSubGoal(goal.id, newSubGoal.trim());
    setNewSubGoal("");
  };

  const confirmDelete = () => {
    Alert.alert(
      t("lifeGoals.deleteConfirmTitle"),
      t("lifeGoals.deleteConfirmMessage"),
      [
        { text: t("warranties.cancel"), style: "cancel" },
        {
          text: t("lifeGoals.delete"),
          style: "destructive",
          onPress: () => {
            removeGoal(goal.id);
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
          title: goal.title,
          headerRight: () => (
            <Pressable
              onPress={() => setShowEdit(true)}
              style={styles.editButton}
            >
              <SymbolView
                name={{ ios: "pencil", android: "edit", web: "edit" }}
                size={20}
                tintColor={textMuted}
              />
              <Text style={{ color: textMuted }}>{t("lifeGoals.edit")}</Text>
            </Pressable>
          ),
        }}
      />

      {total > 0 && (
        <Card style={styles.progressCard}>
          <RingProgress progress={progress} size={80} strokeWidth={8} />
          <Text style={{ color: textMuted }}>
            {t("lifeGoals.progressLabel", { done, total })}
          </Text>
        </Card>
      )}

      <Text style={sharedStyles.sectionLabel}>
        {t("lifeGoals.subGoalsLabel")}
      </Text>
      {goal.subGoals.length === 0 ? (
        <Text style={[sharedStyles.emptyState, { color: textMuted }]}>
          {t("lifeGoals.noSubGoals")}
        </Text>
      ) : (
        <View style={sharedStyles.list}>
          {goal.subGoals.map((sg) => (
            <Card key={sg.id} style={sharedStyles.rowBetween}>
              <Pressable
                style={styles.subGoalRow}
                onPress={() => toggleSubGoal(goal.id, sg.id)}
              >
                <SymbolView
                  name={{
                    ios: sg.completed ? "checkmark.circle.fill" : "circle",
                    android: sg.completed
                      ? "check_circle"
                      : "radio_button_unchecked",
                    web: sg.completed
                      ? "check_circle"
                      : "radio_button_unchecked",
                  }}
                  tintColor={sg.completed ? tintColor : borderColor}
                  size={20}
                />
                <Text
                  style={[
                    styles.subGoalText,
                    sg.completed && {
                      color: textMuted,
                      textDecorationLine: "line-through",
                    },
                  ]}
                >
                  {sg.title}
                </Text>
              </Pressable>
              <Pressable onPress={() => removeSubGoal(goal.id, sg.id)}>
                <SymbolView
                  name={{ ios: "xmark", android: "close", web: "close" }}
                  size={16}
                  tintColor={borderColor}
                />
              </Pressable>
            </Card>
          ))}
        </View>
      )}

      <View style={styles.addRow}>
        <TextInput
          style={[
            sharedStyles.input,
            styles.addInput,
            { borderColor, backgroundColor: surface },
          ]}
          placeholder={t("lifeGoals.newSubGoalPlaceholder")}
          placeholderTextColor={borderColor}
          value={newSubGoal}
          onChangeText={setNewSubGoal}
          onSubmitEditing={addSub}
        />
        <Pressable style={[styles.addButton, { borderColor }]} onPress={addSub}>
          <Text style={styles.addButtonText}>{t("lifeGoals.addSubGoal")}</Text>
        </Pressable>
      </View>

      <Modal
        visible={showEdit}
        animationType="slide"
        transparent
        onRequestClose={() => setShowEdit(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowEdit(false)}
        >
          <Pressable
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <Card style={sharedStyles.card}>
              <TextInput
                style={[
                  sharedStyles.input,
                  { borderColor, backgroundColor: surface },
                ]}
                value={title}
                onChangeText={setTitle}
              />
              <TextInput
                style={[
                  sharedStyles.input,
                  { borderColor, backgroundColor: surface },
                ]}
                placeholder={t("lifeGoals.descriptionPlaceholder")}
                placeholderTextColor={borderColor}
                value={description}
                onChangeText={setDescription}
              />
              <Text style={sharedStyles.fieldLabel}>
                {t("lifeGoals.deadlineLabel")}
              </Text>
              <DatePickerField
                value={deadline || new Date().toISOString().split("T")[0]}
                onChange={setDeadline}
              />
            </Card>

            <Button
              label={t("lifeGoals.save")}
              disabled={!canSave}
              onPress={save}
            />
            <Button
              label={t("lifeGoals.delete")}
              variant="danger"
              onPress={confirmDelete}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </ScrollView>
  );
}

const styles = {
  progressCard: { alignItems: "center" as const, gap: 6 },
  subGoalRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    flex: 1,
  },
  subGoalText: { fontSize: 15 },
  addRow: { flexDirection: "row" as const, gap: 8 },
  addInput: { flex: 1 },
  addButton: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    justifyContent: "center" as const,
  },
  addButtonText: { fontWeight: "700" as const },
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
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
};