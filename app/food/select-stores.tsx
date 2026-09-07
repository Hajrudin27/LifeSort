import { SymbolView } from "expo-symbols";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FlatList, Pressable } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useAccentTints } from "@/hooks/useAccentTints";
import { useFoodStore } from "@/store/useFoodStore";

export default function SelectStoresScreen() {
  const { t } = useTranslation();
  const accentTints = useAccentTints();
  const tintColor = accentTints.accent;
  const textMuted = useThemeColor({}, "textMuted");

  const selectedStores = useFoodStore((s) => s.selectedStores);
  const toggleStoreSelection = useFoodStore((s) => s.toggleStoreSelection);
  const globalStandardPrices = useFoodStore((s) => s.globalStandardPrices);
  const globalOffers = useFoodStore((s) => s.globalOffers);

  const availableStores = useMemo(() => {
    const set = new Set<string>();
    globalStandardPrices.forEach((p) => set.add(p.store));
    globalOffers.forEach((o) => set.add(o.store));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "da"));
  }, [globalStandardPrices, globalOffers]);

  return (
    <View style={sharedStyles.formContainer}>
      <Text style={[styles.hint, { color: textMuted }]}>{t("food.selectStoresHint")}</Text>

      <FlatList
        data={availableStores}
        keyExtractor={(store) => store}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t("food.noStoresYet")}</Text>
          </Card>
        }
        renderItem={({ item: store }) => {
          const isSelected = selectedStores.includes(store);
          return (
            <Pressable accessibilityRole="button" onPress={() => toggleStoreSelection(store)}>
              <Card style={sharedStyles.rowBetween}>
                <Text style={styles.name}>{store}</Text>
                {isSelected && (
                  <SymbolView name={{ ios: "checkmark", android: "check", web: "check" }} tintColor={tintColor} size={20} />
                )}
              </Card>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

const styles = {
  hint: { fontSize: 13, marginBottom: 12 },
  name: { fontWeight: "700" as const },
};