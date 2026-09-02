import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';

type Props = {
  label: string;
  tintColor?: string;
  onPress?: () => void;
};

export default function EconomyModuleCard({ label, tintColor, onPress }: Props) {
  const defaultBackground = useThemeColor({}, 'surface');
  const borderColor = useThemeColor({}, 'border');

  return (
    <Pressable
      style={[styles.card, { backgroundColor: tintColor ?? defaultBackground, borderColor }]}
      onPress={onPress}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    aspectRatio: 1,
    borderWidth: 1,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    margin: 6,
    shadowColor: '#3B2C24',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 8,
    elevation: 2,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
});