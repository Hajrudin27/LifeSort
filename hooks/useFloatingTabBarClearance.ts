import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Height of the floating tab bar at rest. The compact bar is shorter, so this is the safe upper bound. */
export const FLOATING_TAB_BAR_HEIGHT = 72;

/** Breathing room kept between the last piece of scroll content and the top of the bar. */
const CONTENT_GAP = 16;

/** Distance from the bottom edge of the screen to the bottom of the bar. */
export function floatingTabBarBottomOffset(insetBottom: number): number {
  return Math.max(insetBottom + 8, 18);
}

/**
 * How much bottom padding a tab screen's scroll content needs so that its last element rests fully
 * above the floating bar. It is the bar's own footprint (offset + height) plus a gap, so it follows
 * the device's safe-area inset instead of a fixed guess.
 */
export function floatingTabBarClearance(insetBottom: number): number {
  return floatingTabBarBottomOffset(insetBottom) + FLOATING_TAB_BAR_HEIGHT + CONTENT_GAP;
}

export function useFloatingTabBarClearance(): number {
  const insets = useSafeAreaInsets();
  return floatingTabBarClearance(insets.bottom);
}
