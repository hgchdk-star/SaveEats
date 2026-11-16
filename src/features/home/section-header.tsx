import { StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/ui/button';
import { colors, spacing, text } from '@/theme';

/** 섹션 제목. action을 주면 제목 옆에 작은 텍스트 링크를 둔다(버튼으로 크게 만들지 않는다) */
export function SectionHeader({ title, action }: { title: string; action?: { label: string; onPress: () => void } }) {
  return (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {action ? (
        <TextButton size="sm" onPress={action.onPress}>
          {action.label}
        </TextButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    paddingHorizontal: spacing[5],
    marginBottom: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...text.h2,
    color: colors.ink,
  },
});
