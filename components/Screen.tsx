import { ReactNode } from 'react';
import { ScrollView, ScrollViewProps, StyleSheet } from 'react-native';

import { useThemeColor, View } from '@/components/Themed';

type Props = ScrollViewProps & {
  children: ReactNode;
  padded?: boolean;
};

export default function Screen({ children, padded = true, contentContainerStyle, style, ...props }: Props) {
  const backgroundColor = useThemeColor({}, 'background');

  return (
    <View style={[styles.root, { backgroundColor }, style]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[padded && styles.content, contentContainerStyle]}
        {...props}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 16, gap: 14, paddingBottom: 48 },
});
