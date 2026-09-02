import { SymbolView } from 'expo-symbols';
import { StyleSheet } from 'react-native';

import { Text, View } from '@/components/Themed';

type Props = {
  label: string;
  color: string;
  backgroundColor: string;
  icon?: { ios: string; android: string; web: string };
  style?: object;
};

// Den lille, farvede pille-label brugt øverst på formularer og som
// sektionsoverskrifter gennem hele appen (fx "GARANTIER", "FORDELING").
export default function Kicker({ label, color, backgroundColor, icon, style }: Props) {
  return (
    <View style={[styles.kicker, { backgroundColor }, style]}>
      {icon && <SymbolView name={icon as any} size={12} tintColor={color} />}
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  kicker: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    borderRadius: 20,
    paddingVertical: 5,
    paddingHorizontal: 12,
    backgroundColor: 'transparent', // overskrives altid af prop, men sikrer korrekt default
  },
  text: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    backgroundColor: 'transparent',
  },
});