import { SymbolView } from 'expo-symbols';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PanResponder, Pressable, StyleSheet } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';

import { Text, useThemeColor, View } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints } from '@/constants/Colors';

type Props = {
  cycleDay: number | null;
  avgCycleLength: number;
  periodLength: number;
  fertileStartDay: number | null;
  fertileEndDay: number | null;
  daysUntilNext: number | null;
  getPhaseLabelForOffset: (offsetDays: number) => string;
  locale: string;
  size?: number;
};

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToCartesian(cx, cy, r, endDeg);
  const end = polarToCartesian(cx, cy, r, startDeg);
  const largeArc = endDeg - startDeg <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function touchToDay(x: number, y: number, size: number, avgCycleLength: number): number {
  const cx = size / 2;
  const cy = size / 2;
  const dx = x - cx;
  const dy = y - cy;
  let angleDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  const rawDay = (angleDeg / 360) * avgCycleLength;
  const day = Math.round(rawDay);
  return day === 0 ? avgCycleLength : day;
}

export default function CycleWheel({
  cycleDay,
  avgCycleLength,
  periodLength,
  fertileStartDay,
  fertileEndDay,
  daysUntilNext,
  getPhaseLabelForOffset,
  locale,
  size = 240,
}: Props) {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const cycleTints = CycleTints[colorScheme];
  const textMuted = useThemeColor({}, 'textMuted');
  const surfaceMuted = useThemeColor({}, 'surfaceMuted');

  const danger = cycleTints.period;
  const tint = cycleTints.fertile;
  const warning = cycleTints.ovulation;

  const [dayOffset, setDayOffset] = useState(0);
  const cycleDayRef = useRef(cycleDay);
  cycleDayRef.current = cycleDay;

  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 20;
  const strokeWidth = 16;

  const dayToDeg = (day: number) => (day / avgCycleLength) * 360;

  const periodEndDeg = dayToDeg(periodLength);
  const fertileStartDeg = fertileStartDay !== null ? dayToDeg(fertileStartDay) : null;
  const fertileEndDeg = fertileEndDay !== null ? dayToDeg(fertileEndDay) : null;

  const displayedCycleDay = cycleDay !== null ? cycleDay + dayOffset : null;
  const displayedDeg =
    displayedCycleDay !== null
      ? dayToDeg((((displayedCycleDay - 1) % avgCycleLength) + avgCycleLength) % avgCycleLength + 1)
      : null;
  const displayedPoint = displayedDeg !== null ? polarToCartesian(cx, cy, r, displayedDeg) : null;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (evt) => {
        if (cycleDayRef.current === null) return;
        const { locationX, locationY } = evt.nativeEvent;
        const touchedDay = touchToDay(locationX, locationY, size, avgCycleLength);
        setDayOffset(touchedDay - cycleDayRef.current);
      },
    })
  ).current;

  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size }} {...panResponder.panHandlers}>
        <Svg width={size} height={size}>
          <Defs>
            <LinearGradient id="periodGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={danger} stopOpacity={1} />
              <Stop offset="100%" stopColor={warning} stopOpacity={0.85} />
            </LinearGradient>
            <LinearGradient id="fertileGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor={tint} stopOpacity={1} />
              <Stop offset="100%" stopColor={danger} stopOpacity={0.7} />
            </LinearGradient>
          </Defs>

          <Circle cx={cx} cy={cy} r={r + 14} fill={cycleTints.accentSoft} opacity={0.4} />
          <Circle cx={cx} cy={cy} r={r + 6} fill={cycleTints.accentSoft} opacity={0.55} />

          <Circle cx={cx} cy={cy} r={r} stroke={surfaceMuted} strokeWidth={strokeWidth} fill="none" />

          <Path
            d={describeArc(cx, cy, r, 0, periodEndDeg)}
            stroke="url(#periodGradient)"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
          />

          {fertileStartDeg !== null && fertileEndDeg !== null && (
            <Path
              d={describeArc(cx, cy, r, fertileStartDeg, fertileEndDeg)}
              stroke="url(#fertileGradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              fill="none"
            />
          )}

          {displayedPoint && (
            <G>
              <Circle cx={displayedPoint.x} cy={displayedPoint.y} r={17} fill={warning} opacity={0.25} />
              <Circle cx={displayedPoint.x} cy={displayedPoint.y} r={13} fill={warning} stroke="#FFFFFF" strokeWidth={3} />
            </G>
          )}

          <SvgText x={cx} y={cy - 10} fontSize={32} fontWeight="800" fill={textMuted} textAnchor="middle">
            {displayedCycleDay ?? '–'}
          </SvgText>
          <SvgText x={cx} y={cy + 12} fontSize={11} fill={textMuted} textAnchor="middle" opacity={0.7}>
            {t('cycle.wheelDayLabel')}
          </SvgText>
          {dayOffset === 0 && daysUntilNext !== null ? (
            <SvgText x={cx} y={cy + 30} fontSize={12} fontWeight="700" fill={danger} textAnchor="middle">
              {daysUntilNext > 0 ? t('cycle.daysUntilNext', { days: daysUntilNext }) : ''}
            </SvgText>
          ) : (
            <SvgText x={cx} y={cy + 30} fontSize={12} fontWeight="700" fill={textMuted} textAnchor="middle">
              {getPhaseLabelForOffset(dayOffset)}
            </SvgText>
          )}
        </Svg>
      </View>

      {dayOffset !== 0 && (
        <Pressable accessibilityRole="button" onPress={() => setDayOffset(0)} style={styles.resetLink}>
          <SymbolView name={{ ios: 'arrow.uturn.left', android: 'undo', web: 'undo' }} size={13} tintColor={tint} />
          <Text style={[styles.resetLinkText, { color: tint }]}>{t('cycle.wheelBackToToday')}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  resetLink: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  resetLinkText: { fontSize: 12, fontWeight: '700' },
});