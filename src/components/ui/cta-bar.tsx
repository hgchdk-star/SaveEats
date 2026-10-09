import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, font, shadow, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { ButtonCount, PrimaryButton, SecondaryButton, TextButton } from './button';

/**
 * 화면 아래에 고정되는 CTA 바. 쌓이는 화면은 하단 탭 대신 이 바를 쓴다.
 * 위쪽 안내 한 줄(note)은 버튼이 막힌 이유를 알린다.
 */
function CtaFrame({ note, question, children, footer }: { note?: string; question?: string; children: ReactNode; footer?: ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: footer ? spacing[1] : insets.bottom + spacing[3] }]}>
      {question ? <Text style={styles.question}>{question}</Text> : null}
      {note ? (
        <Text accessibilityLiveRegion="polite" style={styles.note}>
          {note}
        </Text>
      ) : null}
      {children}
      {footer ? <View style={[styles.footer, { paddingBottom: insets.bottom + spacing[2] }]}>{footer}</View> : null}
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
  /** 버튼 아래 보조 텍스트 버튼 (회원가입 전환, 다른 방법으로 주문하기) */
  sub?: { label: string; onPress: () => void; disabled?: boolean };
};

/** 버튼 한 개짜리 고정 CTA 바 (장바구니 보기, 담기, 로그인 …) */
export function CtaBar({ label, onPress, note, disabled, loading, count, sub }: CtaBarProps) {
  return (
    <CtaFrame
      note={note}
      footer={
        sub ? (
          <TextButton size="sm" disabled={sub.disabled} onPress={sub.onPress}>
            {sub.label}
          </TextButton>
        ) : undefined
      }>
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
  /** 최종 주문 확인에서는 "27,000원 내 계좌로 주문하기" */
  label?: string;
  loading?: boolean;
  sub?: { label: string; onPress: () => void; disabled?: boolean };
};

/** 주문하기 바. 저축·송금·이체 같은 말을 쓰지 않는다 (DS OrderCTA) */
export function OrderCtaBar({ amount, onPress, note, disabled, label, loading, sub }: OrderCtaBarProps) {
  return <CtaBar label={label ?? `${formatWon(amount)} 주문하기`} onPress={onPress} note={note} disabled={disabled} loading={loading} sub={sub} />;
}

type QuestionBarProps = {
  question: string;
  left: { label: string; onPress: () => void; disabled?: boolean };
  right: { label: string; onPress: () => void; disabled?: boolean; loading?: boolean };
  /** 질문 아래 보조 텍스트 버튼 (내역 확인 등) */
  sub?: { label: string; onPress: () => void };
};

/** "주문을 완료하셨나요?" + 두 버튼(아직이에요 / 주문 완료했어요) */
export function QuestionBar({ question, left, right, sub }: QuestionBarProps) {
  return (
    <CtaFrame
      question={question}
      footer={
        sub ? (
          <TextButton size="sm" onPress={sub.onPress}>
            {sub.label}
          </TextButton>
        ) : undefined
      }>
      <View style={styles.pair}>
        <View style={styles.pairLeft}>
          <SecondaryButton size="lg" block disabled={left.disabled} onPress={left.onPress}>
            {left.label}
          </SecondaryButton>
        </View>
        <View style={styles.pairRight}>
          <PrimaryButton size="lg" block disabled={right.disabled} loading={right.loading} onPress={right.onPress}>
            {right.label}
          </PrimaryButton>
        </View>
      </View>
    </CtaFrame>
  );
}

type ActionStackProps = {
  primary?: { label: string; onPress: () => void; icon?: 'refresh'; loading?: boolean; disabled?: boolean };
  secondary?: { label: string; onPress: () => void };
  sub?: { label: string; onPress: () => void };
};

/** 큰 버튼 하나(또는 둘)를 세로로 쌓은 바 (주문 완료, 아직이에요 이후, 저장 실패) */
export function ActionStack({ primary, secondary, sub }: ActionStackProps) {
  return (
    <CtaFrame
      footer={
        sub ? (
          <TextButton size="sm" onPress={sub.onPress}>
            {sub.label}
          </TextButton>
        ) : undefined
      }>
      {primary ? (
        <PrimaryButton block icon={primary.icon} loading={primary.loading} disabled={primary.disabled} onPress={primary.onPress}>
          {primary.label}
        </PrimaryButton>
      ) : null}
      {secondary ? (
        <SecondaryButton size="lg" block onPress={secondary.onPress}>
          {secondary.label}
        </SecondaryButton>
      ) : null}
    </CtaFrame>
  );
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
  question: {
    ...font('700'),
    fontSize: 15,
    lineHeight: 22,
    color: colors.ink,
    textAlign: 'center',
  },
  footer: {
    alignItems: 'center',
  },
  pair: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  pairLeft: {
    flex: 1,
  },
  pairRight: {
    flex: 2,
  },
});
