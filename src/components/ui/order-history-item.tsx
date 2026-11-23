import { Pressable, StyleSheet, Text, View } from 'react-native';

import { draftCopy } from '@/config/draft-copy';
import { colors, font, radius, spacing, text } from '@/theme';
import { formatWon } from '@/utils/format';

import { SecondaryButton, TextButton } from './button';
import { FoodImage } from './food-image';
import { Price } from './price';
import { ReviewWriteButton } from './review-write-button';

type OrderHistoryItemProps = {
  date: string;
  storeName: string;
  imageUri: string | null;
  menuLabel: string;
  amount: number;
  status: 'pending' | 'saveFailed' | 'delivered' | 'cancelled';
  /** 확인하지 않은 주문 상태 업데이트가 있으면 상태 문구 앞에 점 (리뷰와 무관) */
  unread: boolean;
  /** 주문 이어하기를 시작하는 중이면 버튼을 잠근다 */
  busy?: boolean;
  onDetail: () => void;
  onResume?: () => void;
  onRetrySave?: () => void;
  /** 정정으로 취소된 주문이면 취소 옆에 '정정됨'을 붙인다 */
  corrected?: boolean;
  reviewStatus: 'available' | 'written' | 'expired' | null;
  onReview?: () => void;
  /** 같은 주문 담기. 없으면(지금 열 수 있는 메뉴가 없음) 버튼을 숨긴다 */
  onSameOrder?: () => void;
  /** 같은 주문 담기를 처리하는 중이면 버튼을 잠근다(연속 터치 방지) */
  sameOrderBusy?: boolean;
  /** 가게 이름을 누르면 가게 상세로 간다 */
  onStore?: () => void;
};

const copy = draftCopy.history;

/**
 * 내역 한 줄. 주문 당시의 이름·금액을 그대로 보여준다.
 * 상태가 바뀌어도 줄 순서는 그대로다. 줄을 읽음 처리하는 시점은 목록 화면이 정한다.
 */
export function OrderHistoryItem({ date, storeName, imageUri, menuLabel, amount, status, corrected = false, unread, busy = false, onDetail, onResume, onRetrySave, reviewStatus, onReview, onSameOrder, sameOrderBusy = false, onStore }: OrderHistoryItemProps) {
  const label = status === 'delivered' ? copy.delivered(formatWon(amount)) : status === 'pending' ? copy.statusPending : status === 'saveFailed' ? copy.statusSaveFailed : copy.statusCancelled;
  const tone = status === 'delivered' ? styles.toneDone : status === 'cancelled' ? styles.toneMuted : status === 'saveFailed' ? styles.toneBad : styles.tonePending;

  return (
    <View accessible={false} style={styles.card}>
      <View style={styles.top}>
        <Text style={styles.date}>{date}</Text>
        <TextButton size="sm" onPress={onDetail}>
          {copy.detail}
        </TextButton>
      </View>
      <View style={styles.main}>
        <FoodImage uri={imageUri} width={64} rounded={radius.sm} />
        <View style={styles.text}>
          {/* 가게 이름만 눌린다(글자 영역만 터치 영역). 메뉴 이름은 눌리지 않는 글자다 */}
          {onStore ? (
            <Pressable accessibilityRole="link" accessibilityLabel={copy.storeLink(storeName)} onPress={onStore} hitSlop={{ top: 4, bottom: 4, right: 8 }} style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}>
              <Text numberOfLines={1} style={[styles.store, styles.menusLink]}>{storeName}</Text>
            </Pressable>
          ) : (
            <Text style={styles.store}>{storeName}</Text>
          )}
          <Text numberOfLines={1} style={styles.menus}>
            {menuLabel}
          </Text>
          <View accessible accessibilityLabel={`${label}${corrected ? `, ${copy.correctedTag}` : ''}${unread ? `, ${copy.unreadLabel}` : ''}`} style={styles.amountRow}>
            {status !== 'delivered' ? <Price amount={amount} size="sm" /> : null}
            <View style={styles.statusRow}>
              {unread ? <View style={styles.dot} /> : null}
              <Text style={[styles.status, tone]}>
                {label}
                {corrected && status === 'cancelled' ? <Text style={styles.correctedTag}>{` · ${copy.correctedTag}`}</Text> : null}
              </Text>
            </View>
          </View>
        </View>
      </View>

      {status === 'pending' && onResume ? (
        <SecondaryButton size="sm" block disabled={busy} loading={busy} onPress={onResume}>
          {copy.resume}
        </SecondaryButton>
      ) : null}
      {status === 'saveFailed' && onRetrySave ? (
        <SecondaryButton size="sm" block icon="refresh" disabled={busy} onPress={onRetrySave}>
          {copy.retrySave}
        </SecondaryButton>
      ) : null}
      {status === 'delivered' && (reviewStatus || onSameOrder) ? (
        <View style={styles.actions}>
          {reviewStatus ? (
            <View style={reviewStatus === 'expired' ? undefined : styles.reviewButton}>
              <ReviewWriteButton status={reviewStatus} onPress={onReview} />
            </View>
          ) : <View />}
          {onSameOrder ? (
            <TextButton size="sm" disabled={sameOrderBusy} onPress={onSameOrder}>
              {copy.sameOrder}
            </TextButton>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** 불러오는 중 같은 모양의 자리 */
export function OrderHistoryItemSkeleton() {
  return (
    <View accessibilityLabel="불러오는 중" style={styles.card}>
      <View style={[styles.bar, { width: '30%', height: 14 }]} />
      <View style={styles.main}>
        <View style={styles.thumb} />
        <View style={styles.skeletonText}>
          <View style={[styles.bar, { width: '60%', height: 18 }]} />
          <View style={[styles.bar, { width: '80%', height: 14 }]} />
          <View style={[styles.bar, { width: '45%', height: 14 }]} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: spacing[4],
    gap: spacing[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: -4,
  },
  date: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
  main: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  text: {
    flex: 1,
    gap: 2,
  },
  store: {
    ...text.title,
    color: colors.ink,
  },
  menus: {
    ...text.body2,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkSecondary,
  },
  // 눌리는 가게 이름임을 알 수 있게 밑줄만 더한다(색·크기는 그대로)
  menusLink: {
    textDecorationLine: 'underline',
  },
  link: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  linkPressed: {
    opacity: 0.6,
  },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: 2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.notificationDot,
  },
  correctedTag: {
    ...text.caption,
    color: colors.inkTertiary,
  },
  status: {
    ...font('600'),
    fontSize: 12,
    lineHeight: 16,
    flexShrink: 1,
  },
  toneDone: { color: colors.successText },
  toneMuted: { color: colors.inkTertiary },
  toneBad: { color: colors.danger },
  tonePending: { color: colors.ink },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    flexWrap: 'wrap',
  },
  reviewButton: {
    flexShrink: 1,
  },
  bar: {
    borderRadius: radius.xs,
    backgroundColor: colors.foodPlaceholder,
  },
  thumb: {
    width: 64,
    height: 64,
    borderRadius: radius.sm,
    backgroundColor: colors.foodPlaceholder,
  },
  skeletonText: {
    flex: 1,
    gap: 6,
    paddingTop: 4,
  },
});
