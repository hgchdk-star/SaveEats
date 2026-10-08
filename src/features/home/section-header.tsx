import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, text } from '@/theme';

export function SectionHeader({ title }: { title: string }) {
  return (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: spacing[5],
    marginBottom: spacing[3],
  },
  title: {
    ...text.h2,
    color: colors.ink,
  },
});
