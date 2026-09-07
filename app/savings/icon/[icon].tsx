import { router, Stack, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, FlatList, Pressable, TextInput } from "react-native";

import Button from "@/components/Button";
import Card from "@/components/Card";
import Chip from "@/components/Chip";
import ProgressBar from "@/components/ProgressBar";
import SwipeableRow from "@/components/SwipeableRow";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { SavingsGoalIcon } from "@/types/savingsGoal";
import { getIconSymbolName } from "@/utils/savings/savingsGoalIcon";

type SortMode = "progress" | "newest";

export default function SavingsIconScreen() {
  const { t } = useTranslation();
  const { icon } = useLocalSearchParams<{ icon: SavingsGoalIcon }>();
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const textMuted = useThemeColor({}, "textMuted");
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const success = useThemeColor({}, "success");

  const allGoals = useSavingsGoalsStore((s) => s.goals);
  const removeGoal = useSavingsGoalsStore((s) => s.removeGoal);
  const archiveGoal = useSavingsGoalsStore((s) => s.archiveGoal);
  const unarchiveGoal = useSavingsGoalsStore((s) => s.unarchiveGoal);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("progress");
  const [showArchived, setShowArchived] = useState(false);

  const goals = allGoals
    .filter((g) => g.icon === icon)
    .filter((g) => (showArchived ? g.archived : !g.archived))
    .filter((g) => g.name.toLowerCase().includes(search.trim().toLowerCase()))
    .slice()
    .sort((a, b) => {
      if (sortMode === "newest") {
        return b.createdAt.localeCompare(a.createdAt);
      }
      const progressA = a.targetAmount > 0 ? a.savedAmount / a.targetAmount : 0;
      const progressB = b.targetAmount > 0 ? b.savedAmount / b.targetAmount : 0;
      return progressB - progressA;
    });

  const confirmArchive = (id: string) => {
    Alert.alert(
      t("savings.archiveConfirmTitle"),
      t("savings.archiveConfirmMessage"),
      [
        { text: t("savings.cancel"), style: "cancel" },
        { text: t("savings.archive"), onPress: () => archiveGoal(id) },
      ],
    );
  };

  return (
    <View style={sharedStyles.formContainer}>
      <Stack.Screen options={{ title: t(`savings.icons.${icon}`) }} />

      <TextInput
        style={[sharedStyles.input, { borderColor, backgroundColor: surface }]}
        placeholder={t("savings.searchPlaceholder")}
        placeholderTextColor={borderColor}
        value={search}
        onChangeText={setSearch}
      />

      <View style={sharedStyles.chipRow}>
        <Chip
          label={t("savings.sortByProgress")}
          active={sortMode === "progress"}
          onPress={() => setSortMode("progress")}
        />
        <Chip
          label={t("savings.sortByNewest")}
          active={sortMode === "newest"}
          onPress={() => setSortMode("newest")}
        />
      </View>

      <View style={sharedStyles.chipRow}>
        <Chip
          label={t("savings.activeGoals")}
          active={!showArchived}
          onPress={() => setShowArchived(false)}
        />
        <Chip
          label={t("savings.archivedGoals")}
          active={showArchived}
          onPress={() => setShowArchived(true)}
        />
      </View>

      <FlatList
        data={goals}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>
              {showArchived
                ? t("savings.noArchivedGoals")
                : t("savings.emptyState")}
            </Text>
          </Card>
        }
        renderItem={({ item }) => {
          const isReached = item.savedAmount >= item.targetAmount;

          return (
            <SwipeableRow onDelete={() => removeGoal(item.id)}>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push(`/savings/${item.id}`)}
                onLongPress={() => {
                  if (item.archived) {
                    unarchiveGoal(item.id);
                  } else if (isReached) {
                    confirmArchive(item.id);
                  }
                }}
              >
                <Card
                  style={[styles.card, item.archived && styles.archivedCard]}
                >
                  <View style={styles.headerRow}>
                    <SymbolView
                      name={getIconSymbolName(item.icon) as any}
                      size={18}
                      tintColor={isReached ? success : tint}
                    />
                    <Text style={styles.name}>{item.name}</Text>
                    {item.archived ? (
                      <View style={[styles.archivedBadge, { borderColor }]}>
                        <SymbolView
                          name={{
                            ios: "archivebox.fill",
                            android: "archive",
                            web: "archive",
                          }}
                          size={11}
                          tintColor={textMuted}
                        />
                        <Text
                          style={[styles.archivedText, { color: textMuted }]}
                        >
                          {t("savings.archived")}
                        </Text>
                      </View>
                    ) : isReached ? (
                      <View
                        style={[
                          styles.reachedBadge,
                          { backgroundColor: success },
                        ]}
                      >
                        <SymbolView
                          name={{
                            ios: "checkmark",
                            android: "check",
                            web: "check",
                          }}
                          size={11}
                          tintColor="#FFFFFF"
                        />
                        <Text style={styles.reachedText}>
                          {t("savings.reached")}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <ProgressBar
                    progress={item.savedAmount / item.targetAmount}
                  />
                  <Text style={[styles.meta, { color: textMuted }]}>
                    {item.savedAmount.toFixed(2)} {t("savings.of")}{" "}
                    {item.targetAmount.toFixed(2)} kr.
                  </Text>
                  {isReached && !item.archived && (
                    <Text style={[styles.archiveHint, { color: textMuted }]}>
                      {t("savings.longPressToArchive")}
                    </Text>
                  )}
                </Card>
              </Pressable>
            </SwipeableRow>
          );
        }}
      />

      <Button
        label={t("savings.addButton")}
        onPress={() => router.push("/savings/new")}
      />
    </View>
  );
}

const styles = {
  card: { gap: 8, marginBottom: 8 },
  archivedCard: { opacity: 0.6 },
  headerRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
  },
  name: { fontWeight: "700" as const, fontSize: 16, flex: 1 },
  meta: { fontSize: 13 },
  reachedBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  reachedText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" as const },
  archivedBadge: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 3,
    borderRadius: 10,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderWidth: 1,
  },
  archivedText: { fontSize: 10, fontWeight: "700" as const },
  archiveHint: { fontSize: 11, fontStyle: "italic" as const },
};
