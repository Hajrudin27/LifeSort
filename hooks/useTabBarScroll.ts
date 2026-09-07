import { useCallback, useRef } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { useTabBarStore } from '@/store/useTabBarStore';

type ScrollHandler = (event: NativeSyntheticEvent<NativeScrollEvent>) => void;

export function useTabBarScroll(onScroll?: ScrollHandler): ScrollHandler {
  const setCompact = useTabBarStore((s) => s.setCompact);
  const lastOffsetY = useRef(0);
  const lastToggleOffsetY = useRef(0);

  return useCallback(
    (event) => {
      onScroll?.(event);

      const offsetY = Math.max(0, event.nativeEvent.contentOffset.y);
      const deltaY = offsetY - lastOffsetY.current;

      if (offsetY < 18) {
        setCompact(false);
        lastToggleOffsetY.current = offsetY;
      } else if (deltaY > 5 && offsetY - lastToggleOffsetY.current > 18) {
        setCompact(true);
        lastToggleOffsetY.current = offsetY;
      } else if (deltaY < -5 && lastToggleOffsetY.current - offsetY > 12) {
        setCompact(false);
        lastToggleOffsetY.current = offsetY;
      }

      lastOffsetY.current = offsetY;
    },
    [onScroll, setCompact],
  );
}
