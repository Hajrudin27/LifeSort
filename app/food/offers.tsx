import { useTranslation } from "react-i18next";
import { FlatList } from "react-native";

import Card from "@/components/Card";
import { Text, useThemeColor, View } from "@/components/Themed";
import { sharedStyles } from "@/constants/sharedStyles";
import { useFoodPriceReference } from "@/hooks/useFoodPriceReference";
import { offerEvidence, validOfferEntry } from "@/utils/food/priceEvidence";
import { formatPriceEvidence } from "@/utils/food/pricePresentation";
import { useFoodStore } from "@/store/useFoodStore";

export default function OffersScreen() {
  const { t, i18n } = useTranslation();
  const textMuted = useThemeColor({}, "textMuted");

  const globalOffers = useFoodStore((s) => s.globalOffers);
  const selectedStores = useFoodStore((s) => s.selectedStores);

  const reference = useFoodPriceReference();
  const activeOffers = globalOffers.filter(validOfferEntry)
    .filter((offer) => selectedStores.includes(offer.store))
    .map((offer) => ({ ...offer, evidence: offerEvidence(offer, reference) }))
    .filter((offer) => offer.evidence.freshness === 'current')
    .sort((a, b) => a.productName.localeCompare(b.productName, i18n.language));

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
          <Card style={{ gap: 6 }}>
            <View style={styles.rowText}>
              <Text style={styles.name}>{item.productName}</Text>
              <Text style={[styles.meta, { color: textMuted }]}>{formatPriceEvidence(item.evidence, t, i18n.language)}</Text>
            </View>
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
};