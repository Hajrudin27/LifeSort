import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  TextInput,
} from "react-native";

import Button from "@/components/Button";
import ProgressBar from "@/components/ProgressBar";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useHomeBackTitle } from "@/hooks/useHomeBackTitle";
import { useExpensesStore } from "@/store/useExpensesStore";
import { useIncomeStore } from "@/store/useIncomeStore";
import { useSavingsGoalsStore } from "@/store/useSavingsGoalsStore";
import { getIconSymbolName } from "@/utils/savings/savingsGoalIcon";
import { getMonthKey } from "@/utils/shared/monthKey";

export default function SavingsGoalsScreen() {
  const { t } = useTranslation();
  const { from } = useLocalSearchParams<{ from?: string }>();
  useHomeBackTitle(from);

  const accentTints = useAccentTints();
  const goals = useSavingsGoalsStore((s) => s.goals);
  const extraSavings = useSavingsGoalsStore((s) => s.extraSavings);
  const addExtraSavings = useSavingsGoalsStore((s) => s.addExtraSavings);
  const expenses = useExpensesStore((s) => s.expenses);
  const textMuted = useThemeColor({}, "textMuted");
  const success = useThemeColor({}, "success");
  const borderColor = useThemeColor({}, "border");
  const surface = useThemeColor({}, "surface");
  const backgroundColor = useThemeColor({}, "background");

  const incomeByMonth = useIncomeStore((s) => s.incomeByMonth);
  const currentMonthKey = getMonthKey(new Date());
  const netIncome = incomeByMonth[currentMonthKey] ?? 0;
  const totalExpenses = expenses
    .filter((e) => e.nextPaymentDate.slice(0, 7) === currentMonthKey)
    .reduce((sum, e) => sum + e.amount, 0);
  const totalSaved = goals.reduce((sum, g) => sum + g.savedAmount, 0);
  const totalTarget = goals.reduce((sum, g) => sum + g.targetAmount, 0);
  const overallProgress = totalTarget > 0 ? totalSaved / totalTarget : 0;
  const available = netIncome - totalExpenses - totalSaved + extraSavings;

  const usedIcons = Array.from(new Set(goals.map((g) => g.icon)));

  const [showAddModal, setShowAddModal] = useState(false);
  const [addAmount, setAddAmount] = useState("");
  const canAdd = !isNaN(parseFloat(addAmount)) && parseFloat(addAmount) > 0;

  const confirmAdd = () => {
    addExtraSavings(parseFloat(addAmount));
    setAddAmount("");
    setShowAddModal(false);
  };

  return (
    <View style={sharedStyles.formContainer}>
      <View
        style={[
          styles.hero,
          { backgroundColor: accentTints.accent, overflow: "hidden" },
        ]}
      >
        <View
          style={[
            styles.heroCircleLarge,
            { backgroundColor: "#FFFFFF", opacity: 0.08 },
          ]}
        />
        <View
          style={[
            styles.heroCircleSmall,
            { backgroundColor: "#FFFFFF", opacity: 0.1 },
          ]}
        />

        <View style={styles.heroTopRow}>
          <View style={styles.heroIconCircle}>
            <SymbolView
              name={{
                ios: "banknote.fill",
                android: "payments",
                web: "payments",
              }}
              size={20}
              tintColor="#FFFFFF"
            />
          </View>
          <View style={styles.heroTextGroup}>
            <Text style={styles.heroKicker}>{t("savings.available")}</Text>
            <Text style={styles.heroAmount}>{available.toFixed(0)} kr.</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("savings.a11y.addGoal")}
            hitSlop={6}
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <SymbolView
              name={{ ios: "plus", android: "add", web: "add" }}
              size={18}
              tintColor="#FFFFFF"
            />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/savings/allocate")}
          style={styles.heroAllocateRow}
        >
          <Text style={styles.heroAllocateText}>{t("savings.allocate")}</Text>
          <SymbolView
            name={{
              ios: "arrow.right",
              android: "arrow_forward",
              web: "arrow_forward",
            }}
            size={13}
            tintColor="#FFFFFF"
          />
        </Pressable>

        {totalTarget > 0 && (
          <View style={styles.heroProgressWrap}>
            <View style={styles.heroProgressTrack}>
              <View
                style={[
                  styles.heroProgressFill,
                  { width: `${Math.min(overallProgress * 100, 100)}%` },
                ]}
              />
            </View>
            <Text style={styles.heroProgressLabel}>
              {totalSaved.toFixed(0)} {t("savings.of")} {totalTarget.toFixed(0)}{" "}
              kr.
            </Text>
          </View>
        )}
      </View>

      <FlatList
        data={usedIcons}
        keyExtractor={(icon) => icon}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <View
            style={[
              styles.emptyCard,
              { backgroundColor: accentTints.accentSoft },
            ]}
          >
            <SymbolView
              name={{ ios: "target", android: "flag", web: "flag" }}
              size={28}
              tintColor={accentTints.accent}
            />
            <Text style={{ color: textMuted, marginTop: 8 }}>
              {t("savings.emptyState")}
            </Text>
          </View>
        }
        renderItem={({ item: icon }) => {
          const inIcon = goals.filter((g) => g.icon === icon);
          const saved = inIcon.reduce((sum, g) => sum + g.savedAmount, 0);
          const target = inIcon.reduce((sum, g) => sum + g.targetAmount, 0);
          const progress = target > 0 ? saved / target : 0;
          const isReached = target > 0 && saved >= target;

          return (
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.push({
                  pathname: "/savings/icon/[icon]",
                  params: { icon },
                })
              }
            >
              <View
                style={[
                  styles.folderCard,
                  { borderColor: accentTints.accentSoft },
                ]}
              >
                <View style={styles.folderTopRow}>
                  <View style={styles.iconWrap}>
                    <View
                      style={[
                        styles.iconGlow,
                        { backgroundColor: accentTints.accentSoft },
                      ]}
                    />
                    <View
                      style={[
                        styles.iconCircle,
                        {
                          backgroundColor: isReached
                            ? success
                            : accentTints.accent,
                        },
                      ]}
                    >
                      <SymbolView
                        name={getIconSymbolName(icon) as any}
                        size={18}
                        tintColor="#FFFFFF"
                      />
                    </View>
                  </View>
                  <View style={styles.folderText}>
                    <View style={styles.folderNameRow}>
                      <Text style={styles.folderName}>
                        {t(`savings.icons.${icon}`)}
                      </Text>
                      {isReached && (
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
                            size={10}
                            tintColor="#FFFFFF"
                          />
                        </View>
                      )}
                    </View>
                    <Text style={{ color: textMuted, fontSize: 12 }}>
                      {t("savings.goalsCount", { count: inIcon.length })} ·{" "}
                      {saved.toFixed(0)} / {target.toFixed(0)} kr.
                    </Text>
                  </View>
                  <SymbolView
                    name={{
                      ios: "chevron.right",
                      android: "chevron_right",
                      web: "chevron_right",
                    }}
                    size={14}
                    tintColor={textMuted}
                  />
                </View>
                <ProgressBar progress={progress} />
              </View>
            </Pressable>
          );
        }}
      />

      <Button
        label={t("savings.addButton")}
        onPress={() => router.push("/savings/new")}
      />

      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent
        onRequestClose={() => setShowAddModal(false)}
      >
        <Pressable
          accessible={false}
          style={styles.modalBackdrop}
          onPress={() => setShowAddModal(false)}
        >
          <Pressable
            accessible={false}
            style={[styles.modalCard, { backgroundColor, borderColor }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View
              style={[
                styles.modalKicker,
                { backgroundColor: accentTints.accentSoft },
              ]}
            >
              <Text
                style={[styles.modalKickerText, { color: accentTints.accent }]}
              >
                {t("savings.addExtraTitle")}
              </Text>
            </View>
            <Text style={{ color: textMuted, fontSize: 13, marginBottom: 4 }}>
              {t("savings.addExtraHint")}
            </Text>
            <TextInput
              style={[
                sharedStyles.input,
                { borderColor, backgroundColor: surface },
              ]}
              placeholder={t("savings.initialAmountPlaceholder")}
              placeholderTextColor={borderColor}
              keyboardType="decimal-pad"
              value={addAmount}
              onChangeText={setAddAmount}
              autoFocus
            />
            <Button
              label={t("savings.confirm")}
              disabled={!canAdd}
              onPress={confirmAdd}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    padding: 20,
    gap: 4,
    position: "relative",
    borderRadius: 20,
    marginBottom: 4,
  },
  heroCircleLarge: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    top: -50,
    right: -40,
  },
  heroCircleSmall: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    bottom: -25,
    left: -15,
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: "transparent",
  },
  heroIconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroTextGroup: { backgroundColor: "transparent", flex: 1 },
  heroKicker: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
    opacity: 0.85,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    backgroundColor: "transparent",
  },
  heroAmount: {
    fontSize: 28,
    fontWeight: "800",
    color: "#FFFFFF",
    backgroundColor: "transparent",
    marginTop: 2,
  },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroAllocateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 12,
    backgroundColor: "transparent",
    alignSelf: "flex-start",
  },
  heroAllocateText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#FFFFFF",
    backgroundColor: "transparent",
  },
  heroProgressWrap: { marginTop: 16, backgroundColor: "transparent" },
  heroProgressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.25)",
    overflow: "hidden",
  },
  heroProgressFill: {
    height: "100%",
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },
  heroProgressLabel: {
    fontSize: 12,
    color: "#FFFFFF",
    opacity: 0.9,
    marginTop: 6,
    backgroundColor: "transparent",
  },
  emptyCard: { alignItems: "center", borderRadius: 20, padding: 32 },
  folderCard: {
    borderWidth: 1.5,
    borderRadius: 18,
    padding: 14,
    gap: 10,
    marginBottom: 4,
  },
  folderTopRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  iconGlow: { position: "absolute", width: 40, height: 40, borderRadius: 20 },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  folderText: { flex: 1, gap: 2 },
  folderNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  folderName: { fontWeight: "800", fontSize: 15 },
  reachedBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  modalCard: {
    borderTopWidth: 1,
    borderRadius: 20,
    padding: 16,
    paddingBottom: 32,
    gap: 10,
  },
  modalKicker: {
    alignSelf: "flex-start",
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
  },
  modalKickerText: {
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
