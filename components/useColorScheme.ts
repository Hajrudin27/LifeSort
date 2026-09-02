import { useColorScheme as useSystemColorScheme } from "react-native";

import { useThemeStore } from "@/store/useThemeStore";

export function useColorScheme(): "light" | "dark" {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useSystemColorScheme();

  if (mode === "system") {
    return systemScheme === "dark" ? "dark" : "light";
  }
  return mode;
}
