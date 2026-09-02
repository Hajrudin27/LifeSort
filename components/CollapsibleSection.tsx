import { SymbolView } from 'expo-symbols';
import { ReactNode, useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Text, useThemeColor, View } from '@/components/Themed';

type Props = {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
};

export default function CollapsibleSection({ title, defaultOpen = false, children }: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const textMuted = useThemeColor({}, 'textMuted');

  return (
    <View>
      <Pressable style={styles.header} onPress={() => setIsOpen(!isOpen)}>
        <Text style={styles.title}>{title}</Text>
        <SymbolView
          name={{
            ios: isOpen ? 'chevron.up' : 'chevron.down',
            android: isOpen ? 'expand_less' : 'expand_more',
            web: isOpen ? 'expand_less' : 'expand_more',
          }}
          size={16}
          tintColor={textMuted}
        />
      </Pressable>
      {isOpen && <View style={styles.content}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 },
  title: { opacity: 0.6, fontSize: 13, fontWeight: '600' },
  content: { marginTop: 4, marginBottom: 8 },
});
