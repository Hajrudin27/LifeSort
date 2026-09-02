import { useColorScheme } from '@/components/useColorScheme';
import { ModuleTints, ModuleTintsMasculine } from '@/constants/Colors';
import { useProfileStore } from '@/store/useProfileStore';

export function useModuleTints() {
  const colorScheme = useColorScheme();
  const gender = useProfileStore((s) => s.profile.gender);

  const palette = gender === 'male' ? ModuleTintsMasculine : ModuleTints;
  return palette[colorScheme];
}