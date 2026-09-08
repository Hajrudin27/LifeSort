import { StyleSheet } from 'react-native';

import Card from '@/components/Card';
import { useThemeColor, View } from '@/components/Themed';

/**
 * Pladsholder for et Home-kort, mens dataene hentes (APP-014).
 *
 * Har samme højde som et rigtigt kort, så indholdet ikke hopper, når det
 * lander. Skelettet er markeret som ikke-læsbart for skærmlæsere: der er intet
 * at læse højt, og "tom, tom, tom" er ikke information.
 */
export default function MetricCardSkeleton({ style }: { style?: object }) {
  const textMuted = useThemeColor({}, 'textMuted');
  const block = { backgroundColor: `${textMuted}1F` };

  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={style}>
      <Card style={styles.card}>
        <View style={[styles.iconCircle, block]} />
        <View style={[styles.label, block]} />
        <View style={[styles.value, block]} />
        <View style={[styles.helper, block]} />
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 122, gap: 8, borderWidth: 1.5, borderColor: 'transparent' },
  iconCircle: { width: 34, height: 34, borderRadius: 14, marginBottom: 2 },
  label: { height: 9, width: '55%', borderRadius: 4 },
  value: { height: 16, width: '42%', borderRadius: 5 },
  helper: { height: 9, width: '75%', borderRadius: 4 },
});
