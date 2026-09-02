import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

import { Text, useThemeColor, View } from "@/components/Themed";
import { SavingsContribution } from "@/types/savingsGoal";

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
  const { t } = useTranslation();
  const lineColor = useThemeColor({}, "tint");
  const trackColor = useThemeColor({}, "border");

  if (contributions.length === 0) {
    return <Text style={styles.empty}>{t("savings.noHistory")}</Text>;
  }

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
    <View style={styles.wrap}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: 8 },
  empty: { opacity: 0.5, fontSize: 13, marginVertical: 8 },
});
