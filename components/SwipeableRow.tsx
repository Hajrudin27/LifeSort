import { SymbolView } from 'expo-symbols';
import { useTranslation } from 'react-i18next';
import { ReactNode } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

import { useThemeColor } from '@/components/Themed';

type Props = {
  children: ReactNode;
  onDelete: () => void;
};

export default function SwipeableRow({ children, onDelete }: Props) {
  const { t } = useTranslation();
  const danger = useThemeColor({}, 'danger');

  const renderRightActions = (progress: Animated.AnimatedInterpolation<number>) => {
    const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.a11y.delete')}
        style={[styles.deleteAction, { backgroundColor: danger }]}
        onPress={onDelete}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <SymbolView name={{ ios: 'trash', android: 'delete', web: 'delete' }} size={22} tintColor="#FFFFFF" />
        </Animated.View>
      </Pressable>
    );
  };

  return <Swipeable renderRightActions={renderRightActions}>{children}</Swipeable>;
}

const styles = StyleSheet.create({
  deleteAction: {
    justifyContent: 'center',
    alignItems: 'center',
    width: 72,
    borderRadius: 16,
    marginBottom: 8,
  },
});