import { StyleSheet, Text, View } from 'react-native';

import { colors, font, radius, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { Icon, type IconName } from './icon';

export type DeliveryStatusKind = 'pending' | 'saveFailed' | 'delivered' | 'registered' | 'cancelled';

type DeliveryStatusProps = {
  status: DeliveryStatusKind;
  /** 큰 가운데 정렬. 주문 완료·계좌 등록 완료 화면에 쓴다 */
  large?: boolean;
  amount?: number;
  bankName?: string;
  last4?: string;
  /** 제목 바꾸기 (완료 확인 저장 실패 등) */
  title?: string;
};

/**
 * 주문·계좌 상태 카드 (DS DeliveryStatus). 초록은 계좌 도착·등록 완료 같은 성공 표시에만 쓴다.
 * 완료는 사용자 확인(USER_CONFIRMED)이므로 "검증 완료"·"은행 확인" 같은 표현을 쓰지 않는다.
 */
export function DeliveryStatus({ status, large = false, amount, bankName, last4, title }: DeliveryStatusProps) {
  const account = bankName && last4 ? `${bankName} •••• ${last4}` : '';
  const copy = COPY[status](amount, account);
  const tone = TONE[status];

  return (
    <View
      accessibilityRole="summary"
      accessibilityLiveRegion="polite"
      style={[styles.card, { backgroundColor: tone.background, borderColor: tone.border }, large && styles.large]}>
      <View style={[styles.icon, large && styles.iconLarge, { backgroundColor: tone.iconBackground }]}>
        <Icon name={copy.icon} size={large ? 32 : 20} color={tone.iconColor} strokeWidth={2.25} />
      </View>
      <View style={[styles.text, large && styles.textLarge]}>
        <Text style={[large ? styles.titleLarge : styles.title, large && styles.center]}>{title ?? copy.title}</Text>
        {copy.sub ? <Text style={[large ? styles.subLarge : styles.sub, { color: tone.sub }, large && styles.center]}>{copy.sub}</Text> : null}
      </View>
    </View>
  );
}

const COPY: Record<DeliveryStatusKind, (amount: number | undefined, account: string) => { icon: IconName; title: string; sub: string }> = {
  pending: (amount, account) => ({
    icon: 'clock',
    title: '주문 완료가 필요해요',
    sub: [amount !== undefined ? formatWon(amount) : '', account].filter(Boolean).join(' · '),
  }),
  saveFailed: () => ({ icon: 'alert', title: '주문 상태를 저장하지 못했어요', sub: '송금을 이미 완료했다면 다시 송금하지 마세요.' }),
  delivered: (amount, account) => ({
    icon: 'check',
    title: `${formatWon(amount ?? 0)}이 내 계좌로 배달됐어요`,
    sub: account ? `${account}에 도착` : '',
  }),
  registered: (_amount, account) => ({
    icon: 'check',
    title: '계좌 등록이 완료됐어요',
    sub: account ? `${account} · 이제 주문금액이 이 계좌로 배달돼요` : '',
  }),
  cancelled: () => ({ icon: 'close', title: '주문이 취소됐어요', sub: '' }),
};

const TONE: Record<DeliveryStatusKind, { background: string; border: string; iconBackground: string; iconColor: string; sub: string }> = {
  pending: { background: colors.surface, border: colors.line, iconBackground: colors.surfaceMuted, iconColor: colors.inkSecondary, sub: colors.inkTertiary },
  cancelled: { background: colors.surface, border: colors.line, iconBackground: colors.surfaceMuted, iconColor: colors.inkSecondary, sub: colors.inkTertiary },
  delivered: { background: colors.successSoft, border: 'transparent', iconBackground: colors.success, iconColor: colors.onBrand, sub: colors.successText },
  registered: { background: colors.successSoft, border: 'transparent', iconBackground: colors.success, iconColor: colors.onBrand, sub: colors.successText },
  saveFailed: { background: colors.dangerSoft, border: 'transparent', iconBackground: colors.danger, iconColor: colors.onBrand, sub: colors.inkSecondary },
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    padding: spacing[4],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  large: {
    flexDirection: 'column',
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    paddingVertical: spacing[8],
    paddingHorizontal: spacing[5],
    gap: spacing[4],
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLarge: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  text: {
    flex: 1,
  },
  textLarge: {
    flex: 0,
    alignItems: 'center',
  },
  center: {
    textAlign: 'center',
  },
  title: {
    ...text.title,
    color: colors.ink,
  },
  titleLarge: {
    ...text.h1,
    color: colors.ink,
  },
  sub: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  subLarge: {
    ...font('400'),
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing[1],
  },
});
