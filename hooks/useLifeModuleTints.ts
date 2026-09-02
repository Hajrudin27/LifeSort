import { useColorScheme } from '@/components/useColorScheme';
import { LifeModuleTints, LifeModuleTintsMasculine } from '@/constants/Colors';
import { useProfileStore } from '@/store/useProfileStore';

export function useLifeModuleTints() {
  const colorScheme = useColorScheme();
  const gender = useProfileStore((s) => s.profile.gender);

  const palette = gender === 'male' ? LifeModuleTintsMasculine : LifeModuleTints;
  return palette[colorScheme];
}