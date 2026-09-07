import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleProp, StyleSheet, ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { Text, View } from '@/components/Themed';
import { getCategoryLabel } from '@/utils/expense/expenseCategoryLabel';
import { polarToCartesian } from '@/utils/shared/pieChartMath';

const DARK_COLORS = ['#7A4B3A', '#9C6B4F', '#4A3B32', '#B5865E', '#6B4E3D', '#8F5A45'];
const INCOME_COLOR = '#7A8B6F';

type Props = {
  netIncome: number;
  categoryTotals: { id: string; amount: number }[];
  size?: number;
  interactive?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
};

export default function ExpensePieChart({
  netIncome,
  categoryTotals,
  size = 240,
  interactive = true,
  containerStyle,
}: Props) {
  const { t } = useTranslation();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; percent: number } | null>(null);

  const radius = size / 2;
  const center = size / 2;

  const describeSlice = (startAngle: number, endAngle: number) => {
    const start = polarToCartesian(center, center, radius, endAngle);
    const end = polarToCartesian(center, center, radius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
    return `M ${center} ${center} L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
  };

  const totalExpenses = categoryTotals.reduce((sum, c) => sum + c.amount, 0);
  const remaining = Math.max(netIncome - totalExpenses, 0);
  const pieTotal = Math.max(netIncome, totalExpenses);

  const segments = [
    ...categoryTotals.map((c, i) => ({
      id: c.id,
      label: getCategoryLabel(c.id, t),
      amount: c.amount,
      color: DARK_COLORS[i % DARK_COLORS.length],
    })),
    { id: '__income__', label: t('expenses.incomeLabel'), amount: remaining, color: INCOME_COLOR },
  ].filter((s) => s.amount > 0);

  let angle = 0;
  const slices = segments.map((s) => {
    const sliceAngle = (s.amount / pieTotal) * 360;
    const startAngle = angle;
    const endAngle = angle + sliceAngle;
    angle = endAngle;

    const midAngle = (startAngle + endAngle) / 2;
    const labelPoint = polarToCartesian(center, center, radius * 0.65, midAngle);
    const percent = (s.amount / netIncome) * 100;

    return { ...s, startAngle, endAngle, labelPoint, percent };
  });

  return (
    <View style={[styles.wrap, { width: size, height: size }, containerStyle]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {slices.map((s) => (
          <Path
            key={s.id}
            d={describeSlice(s.startAngle, s.endAngle)}
            fill={s.color}
            onPress={
              interactive
                ? () => setTooltip({ x: s.labelPoint.x, y: s.labelPoint.y, label: s.label, percent: s.percent })
                : undefined
            }
          />
        ))}
      </Svg>

      {interactive && tooltip && (
        <Pressable
          accessibilityRole="button"
          style={[styles.tooltip, { left: tooltip.x - 60, top: tooltip.y - 20 }]}
          onPress={() => setTooltip(null)}>
          <Text style={styles.tooltipText}>{tooltip.label}</Text>
          <Text style={styles.tooltipPercent}>{tooltip.percent.toFixed(1)}%</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  tooltip: {
    position: 'absolute',
    backgroundColor: '#000',
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    width: 120,
    alignItems: 'center',
  },
  tooltipText: { color: '#fff', fontWeight: '600', fontSize: 12 },
  tooltipPercent: { color: '#fff', fontSize: 12, marginTop: 2 },
});