import { useColorScheme } from '@/components/useColorScheme';
import { CycleTints, MasculineTints } from '@/constants/Colors';
import { useProfileStore } from '@/store/useProfileStore';

export function useAccentTints() {
  const colorScheme = useColorScheme();
  const gender = useProfileStore((s) => s.profile.gender);

  const palette = gender === 'male' ? MasculineTints : CycleTints;
  return palette[colorScheme];
}