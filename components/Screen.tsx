import { ReactNode } from 'react';
import { ScrollView, ScrollViewProps, StyleSheet } from 'react-native';

import { useThemeColor, View } from '@/components/Themed';
import { useTabBarScroll } from '@/hooks/useTabBarScroll';

type Props = ScrollViewProps & {
  children: ReactNode;
  padded?: boolean;
};

export default function Screen({
  children,
  padded = true,
  contentContainerStyle,
  onScroll,
  scrollEventThrottle,
  style,
  ...props
}: Props) {
  const backgroundColor = useThemeColor({}, 'background');
  const handleScroll = useTabBarScroll(onScroll);

  return (
    <View style={[styles.root, { backgroundColor }, style]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[padded && styles.content, contentContainerStyle]}
        onScroll={handleScroll}
        scrollEventThrottle={scrollEventThrottle ?? 16}
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
