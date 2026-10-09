import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing } from '@/theme';

type BadgeProps = {
  children: string;
  tone?: 'neutral' | 'brand' | 'dark';
};

const TONE = {
  neutral: { backgroundColor: colors.surfaceMuted, color: colors.inkSecondary },
  brand: { backgroundColor: colors.brandSoft, color: colors.brandText },
  dark: { backgroundColor: colors.ink, color: colors.surface },
} as const;

export function Badge({ children, tone = 'neutral' }: BadgeProps) {
  const { backgroundColor, color } = TONE[tone];
  return (
    <View style={[styles.badge, { backgroundColor }]}>
      <Text style={[styles.label, { color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    height: 22,
    paddingHorizontal: spacing[2],
    borderRadius: radius.xs,
    alignSelf: 'flex-start',
    justifyContent: 'center',
  },
  label: {
    ...font('600'),
    fontSize: 12,
    lineHeight: 16,
  },
});
