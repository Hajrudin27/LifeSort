import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { FlatList } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useFoodStore } from "@/store/useFoodStore";

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

export default function OffersScreen() {
  const { t } = useTranslation();
  const textMuted = useThemeColor({}, "textMuted");
  const success = useThemeColor({}, "success");

  const globalOffers = useFoodStore((s) => s.globalOffers);
  const selectedStores = useFoodStore((s) => s.selectedStores);

  const activeOffers = useMemo(() => {
    const today = todayStr();
    return globalOffers
      .filter((o) => selectedStores.includes(o.store))
      .filter((o) => o.validFrom <= today && o.validTo >= today)
      .sort((a, b) => a.productName.localeCompare(b.productName, "da"));
  }, [globalOffers, selectedStores]);

  return (
    <View style={sharedStyles.formContainer}>
      <Text style={[styles.hint, { color: textMuted }]}>
        {selectedStores.length > 0 ? t("food.offersHint") : t("food.noStoresSelectedHint")}
      </Text>

      <FlatList
        data={activeOffers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={sharedStyles.list}
        ListEmptyComponent={
          <Card style={sharedStyles.emptyCard}>
            <Text style={{ color: textMuted }}>{t("food.offersEmpty")}</Text>
          </Card>
        }
        renderItem={({ item }) => (
          <Card style={sharedStyles.rowBetween}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.productName}</Text>
              <Text style={[styles.meta, { color: textMuted }]}>{item.store}</Text>
            </View>
            <Text style={[styles.price, { color: success }]}>{item.offerPrice.toFixed(2)} kr.</Text>
          </Card>
        )}
      />
    </View>
  );
}

const styles = {
  hint: { fontSize: 13, marginBottom: 4 },
  rowText: { flex: 1 },
  name: { fontWeight: "700" as const },
  meta: { fontSize: 13 },
  price: { fontWeight: "700" as const },
};