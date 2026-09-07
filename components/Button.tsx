import { Pressable, PressableProps, StyleSheet } from 'react-native';

import { Text, useThemeColor } from '@/components/Themed';
import { useAccentTints } from '@/hooks/useAccentTints';

type Variant = 'primary' | 'secondary' | 'danger';

type Props = PressableProps & {
  label: string;
  variant?: Variant;
  disabled?: boolean;
};

export default function Button({ label, variant = 'primary', disabled, style, ...props }: Props) {
  const accentTints = useAccentTints();
  const tint = accentTints.accent;
  const border = useThemeColor({}, 'border');
  const danger = useThemeColor({}, 'danger');
  const surface = useThemeColor({}, 'surface');

  const colors = {
    primary: { bg: tint, borderColor: tint, text: '#FFFFFF' },
    secondary: { bg: surface, borderColor: border, text: tint },
    danger: { bg: surface, borderColor: danger, text: danger },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={[
        styles.button,
        { backgroundColor: colors.bg, borderColor: colors.borderColor },
        disabled && styles.disabled,
        style as object,
      ]}
      {...props}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    borderWidth: 1.5,
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
  },
  label: { fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.4 },
});