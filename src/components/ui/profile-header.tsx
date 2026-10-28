import { StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, text } from '@/theme';

type ProfileHeaderProps = {
  /** 마스킹된 이름. 이름을 수집하지 않으면 null이고 이메일만 보여준다 */
  maskedName: string | null;
  maskedEmail: string;
  initial: string;
};

/** 마이 맨 위 프로필: 동그란 첫 글자 + 마스킹 이름 · 마스킹 이메일. 편집은 없다. [새 컴포넌트 제안] ProfileHeader */
export function ProfileHeader({ maskedName, maskedEmail, initial }: ProfileHeaderProps) {
  return (
    <View style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.avatar}>
        <Text style={styles.initial}>{initial}</Text>
      </View>
      <View style={styles.who}>
        {maskedName ? <Text style={styles.name}>{maskedName}</Text> : null}
        <Text style={maskedName ? styles.email : styles.name}>{maskedEmail}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[4],
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initial: {
    ...font('700'),
    fontSize: 22,
    color: colors.brandText,
  },
  who: {
    flex: 1,
  },
  name: {
    ...text.h2,
    color: colors.ink,
  },
  email: {
    ...text.body2,
    color: colors.inkTertiary,
    marginTop: 2,
  },
});
