import { StyleSheet, Text, View } from 'react-native';

import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, spacing, text } from '@/theme';

import { SecondaryButton, TextButton } from './button';

const copy = confirmedCopy.contentSource;

type SourceNoticeProps = {
  /**
   * available: 출처 목록이 있다 → 안내 + 열기 버튼.
   * unconfirmed: 출처가 없거나 아직 확인되지 않았다 → 버튼 없이 확인 중 안내 (FR-STORE-020).
   * error: 출처를 불러오지 못했다 → 조회 실패 안내 + 다시 시도. 출처 미확인과 구분한다.
   */
  state: 'available' | 'unconfirmed' | 'error';
  onOpen: () => void;
  onRetry: () => void;
};

/**
 * 가게 상세의 모든 탭 마지막에 오는 콘텐츠 출처 안내 (FR-STORE-015 · 016).
 * 목록은 여기에 나열하지 않는다. 버튼은 내부 시트를 열므로 ↗를 붙이지 않는다. 비제휴 문구는 어느 상태에서나 둔다.
 * 출처가 없을 때 이 안내가 보인다고 해서 콘텐츠 공개가 허용된 것은 아니고, 출처 표기가 사용 허락도 아니다 (OPEN-SRC-002).
 */
export function SourceNotice({ state, onOpen, onRetry }: SourceNoticeProps) {
  const body = state === 'available' ? copy.body : state === 'error' ? draftCopy.store.sourceLoadFailed : draftCopy.store.sourceChecking;
  return (
    <View style={styles.root}>
      <Text accessibilityRole="header" style={styles.title}>
        {copy.title}
      </Text>
      <Text accessibilityRole={state === 'error' ? 'alert' : undefined} style={styles.body}>
        {body}
      </Text>
      <Text style={styles.body}>{copy.nonAffiliation}</Text>
      {state === 'available' ? (
        <View style={styles.action}>
          <SecondaryButton size="md" onPress={onOpen}>
            {copy.openButton}
          </SecondaryButton>
        </View>
      ) : null}
      {state === 'error' ? (
        <View style={styles.action}>
          <TextButton size="sm" onPress={onRetry}>
            {draftCopy.store.sourceRetry}
          </TextButton>
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
