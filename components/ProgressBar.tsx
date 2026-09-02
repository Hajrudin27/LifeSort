import { StyleSheet } from 'react-native';

import { useThemeColor, View } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type Props = {
  progress: number;
};

export default function ProgressBar({ progress }: Props) {
  const trackColor = useThemeColor({}, 'surfaceMuted');
  const accentTints = useAccentTints();
  const fillColor = accentTints.accent;
  const clamped = Math.min(Math.max(progress, 0), 1);

  return (
    <View style={[styles.track, { backgroundColor: trackColor }]}>
      <View style={[styles.fill, { width: `${clamped * 100}%`, backgroundColor: fillColor }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 10,
    borderRadius: 5,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 5,
  },
});