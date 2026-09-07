import { SymbolView } from 'expo-symbols';
import { ReactNode, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useColorScheme } from '@/components/useColorScheme';
import Colors from '@/constants/Colors';
import { useTabBarStore } from '@/store/useTabBarStore';

type IconName = { ios: string; android: string; web: string };

type TabRoute = {
  key: string;
  name: string;
  params?: object;
};

type TabDescriptor = {
  options: {
    href?: unknown;
    tabBarLabel?: string | ((props: any) => ReactNode);
    title?: string;
  };
};

type FloatingTabBarProps = {
  descriptors: Record<string, TabDescriptor>;
  navigation: any;
  state: {
    index: number;
    routes: TabRoute[];
  };
};

const TAB_ICONS: Record<string, IconName> = {
  index: { ios: 'house.fill', android: 'home', web: 'home' },
  economy: { ios: 'chart.pie.fill', android: 'pie_chart', web: 'pie_chart' },
  life: { ios: 'star.fill', android: 'star', web: 'star' },
  cycle: { ios: 'drop.fill', android: 'water_drop', web: 'water_drop' },
  settings: { ios: 'gearshape.fill', android: 'settings', web: 'settings' },
};

export default function FloatingTabBar({ descriptors, navigation, state }: FloatingTabBarProps) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme];
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isCompact = useTabBarStore((s) => s.isCompact);
  const setCompact = useTabBarStore((s) => s.setCompact);
  const compactProgress = useRef(new Animated.Value(isCompact ? 1 : 0)).current;

  const visibleRoutes = useMemo(
    () => state.routes.filter((route) => descriptors[route.key]?.options.href !== null),
    [descriptors, state.routes],
  );

  useEffect(() => {
    Animated.timing(compactProgress, {
      toValue: isCompact ? 1 : 0,
      duration: 170,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [compactProgress, isCompact]);

  useEffect(() => {
    setCompact(false);
  }, [setCompact, state.index]);

  const normalWidth = Math.min(width - 36, 430);
  const compactWidth = Math.max(Math.min(width - 116, 292), visibleRoutes.length * 48 + 22);
  const bottomOffset = Math.max(insets.bottom + 8, 18);
  const barBackground = colorScheme === 'dark' ? 'rgba(42,34,29,0.92)' : 'rgba(255,250,242,0.92)';
  const barBorder = colorScheme === 'dark' ? 'rgba(253,246,237,0.14)' : 'rgba(255,255,255,0.78)';
  const activeShell = colorScheme === 'dark' ? 'rgba(255,255,255,0.14)' : 'rgba(22,19,15,0.09)';
  const iconColor = colorScheme === 'dark' ? Colors.dark.text : '#14110E';
  const inactiveColor = colorScheme === 'dark' ? 'rgba(245,237,230,0.58)' : 'rgba(20,17,14,0.62)';

  const animatedBarStyle = {
    borderRadius: compactProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [34, 29],
    }),
    height: compactProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [72, 56],
    }),
    transform: [
      {
        translateY: compactProgress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, 8],
        }),
      },
    ],
    width: compactProgress.interpolate({
      inputRange: [0, 1],
      outputRange: [normalWidth, compactWidth],
    }),
  };
  const labelOpacity = compactProgress.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [1, 0, 0],
  });
  const labelHeight = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [13, 0],
  });
  const labelTranslateY = compactProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -3],
  });

  return (
    <View pointerEvents="box-none" style={[styles.host, { bottom: bottomOffset }]}>
      <Animated.View
        style={[
          styles.bar,
          animatedBarStyle,
          {
            backgroundColor: barBackground,
            borderColor: barBorder,
            shadowColor: theme.text,
          },
        ]}
      >
        {visibleRoutes.map((route) => {
          const routeIndex = state.routes.findIndex((item) => item.key === route.key);
          const isFocused = state.index === routeIndex;
          const options = descriptors[route.key]?.options ?? {};
          const label =
            typeof options.tabBarLabel === 'string'
              ? options.tabBarLabel
              : typeof options.title === 'string'
                ? options.title
                : route.name;
          const tintColor = isFocused ? iconColor : inactiveColor;

          const onPress = () => {
            setCompact(false);
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name, route.params);
            }
          };

          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={isFocused ? { selected: true } : {}}
              key={route.key}
              onPress={onPress}
              style={({ pressed }) => [
                styles.item,
                pressed && styles.itemPressed,
              ]}
            >
              <View
                style={[
                  styles.iconShell,
                  isFocused && {
                    backgroundColor: activeShell,
                    borderColor: barBorder,
                  },
                ]}
              >
                <SymbolView
                  name={(TAB_ICONS[route.name] ?? TAB_ICONS.index) as any}
                  size={isFocused ? 25 : 24}
                  tintColor={tintColor}
                />
              </View>
              <Animated.Text
                numberOfLines={1}
                style={[
                  styles.label,
                  {
                    color: tintColor,
                    height: labelHeight,
                    opacity: labelOpacity,
                    transform: [{ translateY: labelTranslateY }],
                  },
                ]}
              >
                {label}
              </Animated.Text>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    left: 0,
    pointerEvents: 'box-none',
    position: 'absolute',
    right: 0,
  },
  bar: {
    alignItems: 'center',
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: 10,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
  },
  item: {
    alignItems: 'center',
    flex: 1,
    gap: 2,
    height: '100%',
    justifyContent: 'center',
    minWidth: 46,
  },
  itemPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.94 }],
  },
  iconShell: {
    alignItems: 'center',
    borderColor: 'transparent',
    borderRadius: 28,
    borderWidth: 1,
    height: 48,
    justifyContent: 'center',
    width: 58,
  },
  label: {
    fontSize: 11,
    fontWeight: '900',
    overflow: 'hidden',
    lineHeight: 13,
  },
});
