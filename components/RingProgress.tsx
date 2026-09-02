import Svg, { Circle } from 'react-native-svg';

import { Text, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type Props = {
  progress: number; // 0 til 1
  size?: number;
  strokeWidth?: number;
  showLabel?: boolean;
};

export default function RingProgress({ progress, size = 60, strokeWidth = 6, showLabel = true }: Props) {
  const accentTints = useAccentTints();
  const fillColor = accentTints.accent;
  const trackColor = accentTints.accentSoft;

  const clamped = Math.min(Math.max(progress, 0), 1);
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clamped);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' }}>
      <Svg width={size} height={size}>
        <Circle cx={cx} cy={cy} r={radius} stroke={trackColor} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={cx}
          cy={cy}
          r={radius}
          stroke={fillColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          fill="none"
          rotation={-90}
          origin={`${cx}, ${cy}`}
        />
      </Svg>
      {showLabel && (
        <View style={{ position: 'absolute', backgroundColor: 'transparent' }}>
          <Text style={{ fontSize: size * 0.22, fontWeight: '800' }}>{Math.round(clamped * 100)}%</Text>
        </View>
      )}
    </View>
  );
}