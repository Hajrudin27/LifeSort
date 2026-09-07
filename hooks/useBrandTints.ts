import { useColorScheme } from '@/components/useColorScheme';
import { BrandTints, BrandTintsMasculine } from '@/constants/Colors';
import { useProfileStore } from '@/store/useProfileStore';

// Brandfarver til "ink"-hero'en og andre mørke brandflader.
// Følger både tema og profilens palet — samme kontrakt som useAccentTints().
export function useBrandTints() {
  const colorScheme = useColorScheme();
  const gender = useProfileStore((s) => s.profile.gender);

  const palette = gender === 'male' ? BrandTintsMasculine : BrandTints;
  return palette[colorScheme];
}
