import { StyleSheet, Text, View } from 'react-native';

import { colors, font, spacing, text } from '@/theme';

type ProfileHeaderProps = {
  /** 공개 닉네임(닉네임이 없는 기존 계정은 대체 이름). 실명이나 이메일로 대신하지 않는다 */
  name: string;
  maskedEmail: string;
  initial: string;
};

/** 마이 맨 위 프로필: 동그란 첫 글자 + 닉네임 · 마스킹 이메일. 편집은 설정에서 한다. [새 컴포넌트 제안] ProfileHeader */
export function ProfileHeader({ name, maskedEmail, initial }: ProfileHeaderProps) {
  return (
    <View style={styles.row}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.avatar}>
        <Text style={styles.initial}>{initial}</Text>
      </View>
      <View style={styles.who}>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{maskedEmail}</Text>
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
