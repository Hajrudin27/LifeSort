import Svg, { Circle, Line, Polyline, Text as SvgText } from 'react-native-svg';

import { useThemeColor, View } from '@/components/Themed';
import { MonthlyPoint } from '@/utils/expense/economyInsights';

type Props = {
  data: MonthlyPoint[];
  height?: number;
};

const CHART_WIDTH = 300;

export default function TrendLineChart({ data, height = 160 }: Props) {
  const tint = useThemeColor({}, 'tint');
  const border = useThemeColor({}, 'border');
  const textMuted = useThemeColor({}, 'textMuted');

  const values = data.map((d) => d.value);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;

  const paddingTop = 10;
  const paddingBottom = 24;
  const chartHeight = height - paddingTop - paddingBottom;
  const stepX = data.length > 1 ? CHART_WIDTH / (data.length - 1) : CHART_WIDTH;

  const points = data.map((d, i) => ({
    x: i * stepX,
    y: paddingTop + chartHeight - ((d.value - min) / range) * chartHeight,
    ...d,
  }));

  const polylinePoints = points.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <View>
      <Svg width="100%" height={height} viewBox={`0 0 ${CHART_WIDTH} ${height}`}>
        <Line x1={0} y1={paddingTop + chartHeight} x2={CHART_WIDTH} y2={paddingTop + chartHeight} stroke={border} strokeWidth={1} />
        <Polyline points={polylinePoints} fill="none" stroke={tint} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {points.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={3} fill={tint} />
        ))}
        {points.map((p, i) => (
          <SvgText key={`label-${i}`} x={p.x} y={height - 6} fontSize={9} fill={textMuted} textAnchor="middle">
            {p.label}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}