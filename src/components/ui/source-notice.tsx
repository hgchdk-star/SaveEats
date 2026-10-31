import { StyleSheet, Text, View } from 'react-native';

import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, spacing, text } from '@/theme';

import { SecondaryButton } from './button';

const copy = confirmedCopy.contentSource;

type SourceNoticeProps = {
  /** 출처 목록이 있을 때만 열기 버튼을 보여준다. 없거나 미확인이면 버튼 없이 확인 중 안내만 둔다 (FR-STORE-020) */
  available: boolean;
  onOpen: () => void;
};

/**
 * 가게 상세의 모든 탭 마지막에 오는 콘텐츠 출처 안내 (FR-STORE-015 · 016).
 * 목록은 여기에 나열하지 않는다. 버튼은 내부 시트를 열므로 ↗를 붙이지 않는다.
 * 출처가 없을 때 이 안내가 보인다고 해서 콘텐츠 공개가 허용된 것은 아니다 (OPEN-SRC-002).
 */
export function SourceNotice({ available, onOpen }: SourceNoticeProps) {
  return (
    <View style={styles.root}>
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text style={styles.body}>{available ? copy.body : draftCopy.store.sourceChecking}</Text>
      <Text style={styles.body}>{copy.nonAffiliation}</Text>
      {available ? (
        <View style={styles.action}>
          <SecondaryButton size="md" onPress={onOpen}>
            {copy.openButton}
          </SecondaryButton>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    marginHorizontal: spacing[5],
    marginTop: spacing[6],
    paddingTop: spacing[5],
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: spacing[1],
  },
  title: {
    ...text.title,
    color: colors.ink,
    marginBottom: spacing[1],
  },
  body: {
    ...text.body2,
    color: colors.inkSecondary,
  },
  action: {
    alignItems: 'flex-start',
    marginTop: spacing[3],
  },
});
