import { StyleSheet, ViewProps } from 'react-native';

import { useThemeColor, View } from '@/components/Themed';

type Props = ViewProps & { muted?: boolean };

export default function Card({ style, muted, ...props }: Props) {
  const backgroundColor = useThemeColor({}, muted ? 'surfaceMuted' : 'surface');
  const borderColor = useThemeColor({}, 'border');

  return <View style={[styles.card, { backgroundColor, borderColor }, style]} {...props} />;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    shadowColor: '#3B2C24',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 2,
  },
});