import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import { Text, useThemeColor, View } from "@/components/Themed";
import { formatDkk, moneyLocaleFor } from "@/core/money/format";
import { SavingsContribution } from "@/types/savingsGoal";
import { summarizeSavingsHistory } from "@/utils/savings/savingsHistorySummary";

type Props = {
  contributions: SavingsContribution[]; // for ét mål, vilkårlig rækkefølge
  width?: number;
  height?: number;
};

export default function SavingsHistoryChart({
  contributions,
  width = 300,
  height = 120,
}: Props) {
  const { t, i18n } = useTranslation();
  const lineColor = useThemeColor({}, "tint");
  const trackColor = useThemeColor({}, "border");
  const textMuted = useThemeColor({}, "textMuted");

  const summary = summarizeSavingsHistory(contributions);
  if (summary === null) {
    return <Text style={styles.empty}>{t("savings.noHistory")}</Text>;
  }

  // APP-043: the line is not the only carrier of the data. The same facts are
  // the chart's accessibility label and a visible caption.
  const locale = moneyLocaleFor(i18n.language);
  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  const summaryText = t("savings.historySummary", {
    count: summary.count,
    from: formatDate(summary.firstDate),
    to: formatDate(summary.lastDate),
    added: formatDkk(summary.added, locale),
    takenOut: formatDkk(summary.takenOut, locale),
    net: formatDkk(summary.net, locale),
  });

  const sorted = [...contributions].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  );

  let running = 0;
  const cumulative = sorted.map((c) => {
    running += c.amount;
    return running;
  });
  const values = [0, ...cumulative]; // start ved 0, så grafen har en synlig baseline

  const max = Math.max(...values, 1); // undgå division med 0
  const stepX = width / (values.length - 1 || 1);

  const coords = values.map((v, i) => ({
    x: i * stepX,
    y: height - (v / max) * height,
  }));

  const polylinePoints = coords.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <View
      style={styles.wrap}
      accessible
      accessibilityRole="image"
      accessibilityLabel={summaryText}
    >
      <Svg width={width} height={height}>
        <Polyline
          points={`0,${height} ${width},${height}`}
          stroke={trackColor}
          strokeWidth={1}
        />
        <Polyline
          points={polylinePoints}
          stroke={lineColor}
          strokeWidth={2}
          fill="none"
        />
        {coords.slice(1).map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={lineColor} />
        ))}
      </Svg>
      <Text style={[styles.summary, { color: textMuted }]}>{summaryText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 8 },
  empty: { opacity: 0.5, fontSize: 13, marginVertical: 8 },
  summary: { fontSize: 12, marginTop: 8 },
});
