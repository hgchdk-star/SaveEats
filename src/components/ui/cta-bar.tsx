import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, shadow, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { ButtonCount, PrimaryButton } from './button';

/**
 * 화면 아래에 고정되는 CTA 바. 쌓이는 화면은 하단 탭 대신 이 바를 쓴다.
 * 위쪽 안내 한 줄(note)은 버튼이 막힌 이유를 알린다.
 */
function CtaFrame({ note, children }: { note?: string; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom + spacing[3] }]}>
      {note ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {note}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

type CtaBarProps = {
  label: string;
  onPress: () => void;
  note?: string;
  disabled?: boolean;
  loading?: boolean;
  /** 버튼 왼쪽 수량 알약 (가게 상세 "장바구니 보기") */
  count?: number;
};

/** 버튼 한 개짜리 고정 CTA 바 (장바구니 보기, 담기) */
export function CtaBar({ label, onPress, note, disabled, loading, count }: CtaBarProps) {
  return (
    <CtaFrame note={note}>
      <PrimaryButton block disabled={disabled} loading={loading} onPress={onPress} leading={count ? <ButtonCount value={count} /> : undefined}>
        {label}
      </PrimaryButton>
    </CtaFrame>
  );
}

type OrderCtaBarProps = {
  /** 주문 금액. "27,000원 주문하기"로 표시한다 */
  amount: number;
  onPress: () => void;
  note?: string;
  disabled?: boolean;
};

/** 장바구니의 주문하기 바. 저축·송금·이체 같은 말을 쓰지 않는다 (DS OrderCTA) */
export function OrderCtaBar({ amount, onPress, note, disabled }: OrderCtaBarProps) {
  return <CtaBar label={`${formatWon(amount)} 주문하기`} onPress={onPress} note={note} disabled={disabled} />;
}

const styles = StyleSheet.create({
  bar: {
    paddingTop: spacing[3],
    paddingHorizontal: spacing[5],
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    boxShadow: shadow.float,
    gap: spacing[2],
  },
  note: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSecondary,
    textAlign: 'center',
  },
});
