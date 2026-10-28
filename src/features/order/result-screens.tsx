import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/ui/button';
import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { ActionStack, QuestionBar } from '@/components/ui/cta-bar';
import { DeliveryStatus } from '@/components/ui/delivery-status';
import { ErrorState, Spinner } from '@/components/ui/feedback-states';
import { Notice } from '@/components/ui/notice';
import { KeyValueCard } from '@/components/ui/order-info';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { UNDECIDED } from '@/config/undecided';
import { colors, font, spacing, text } from '@/theme';

import { cancelOrder, confirmOrder, notYet, resumeCurrentOrder, runStatusQuery, startReturnCheck } from './order-actions';
import { displayOf } from './order-display';
import { goHistory, goHome, goReviewWrite } from './flow-routes';
import { useOrderFlowStore } from './order-flow-store';
import { useCurrentOrder } from './use-current-order';

const copy = draftCopy.result;
const labels = draftCopy.transfer;

/**
 * 외부 앱에서 돌아온 뒤 서버 상태를 확인하는 중. 앱에 돌아왔다는 것만으로 완료로 보지 않는다 (TRF-008).
 * 조회는 이 화면이 뜬 뒤에 시작한다. 화면이 열리는 중에 곧바로 다른 화면으로 바꾸면 기기에서 멈출 수 있다.
 * 조회가 길어져도 시간이 지나면 조회 실패 화면으로 간다.
 */
export function ReturnCheckScreen() {
  useEffect(() => {
    const timer = setTimeout(() => void runStatusQuery(), LIMITS.returnCheckSettleMs);
    return () => clearTimeout(timer);
  }, []);

  return (
    <Screen top={<TopNavigation />}>
      <View style={styles.centerTop}>
        <Spinner label={copy.returnChecking} />
      </View>
    </Screen>
  );
}

/**
 * '주문을 완료하셨나요?' 질문과, 완료 확인 저장 실패.
 * 저장 실패는 송금 실패가 아니다. 같은 주문의 상태 저장만 다시 시도하고, 외부 앱이나 새 주문 버튼을 두지 않는다 (ORD-010).
 */
export function QuestionScreen() {
  const order = useCurrentOrder();
  const work = useOrderFlowStore((s) => s.work);
  const [cancelSheet, setCancelSheet] = useState(false);
  if (!order) return null;
  const d = displayOf(order);

  const busy = work === 'CONFIRM_SYNCING';
  const saveFailed = work === 'CONFIRM_SAVE_FAILED';
  const cancelUnknown = work === 'CANCEL_UNKNOWN';
  // 미결정 묶음2 #6: 취소는 이 화면의 보조 텍스트 버튼에서 시작한다. 완료 확인 저장이 걸려 있을 때는 취소를 제안하지 않는다
  const canCancel = UNDECIDED.orderCancelEntry === 'confirmQuestionTextButton' && !saveFailed && !cancelUnknown;

  return (
    <Screen
      top={<TopNavigation onClose={goHistory} leadingDisabled={busy} />}
      bottom={
        saveFailed ? (
          <ActionStack
            primary={{ label: confirmedCopy.confirmSaveRetry, icon: 'refresh', loading: busy, disabled: busy, onPress: () => void confirmOrder({ navigateToQuestion: false }) }}
            sub={{ label: confirmedCopy.confirmSaveHistory, onPress: goHistory }}
          />
        ) : (
          <QuestionBar
            question={confirmedCopy.returnQuestion}
            left={{ label: copy.notYet, onPress: notYet, disabled: busy }}
            right={{ label: copy.confirmDone, onPress: () => void confirmOrder({ navigateToQuestion: false }), loading: busy, disabled: busy }}
          />
        )
      }>
      <ScrollView contentContainerStyle={styles.content}>
        {cancelUnknown ? (
          <Notice
            flush
            tone="danger"
            title={copy.cancelUnknownTitle}
            description={copy.cancelUnknownDesc}
            action={{ label: copy.cancelUnknownAction, onPress: () => void cancelOrder() }}
          />
        ) : null}

        {saveFailed ? (
          <DeliveryStatus status="saveFailed" title={copy.confirmSaveFailedTitle} />
        ) : (
          <>
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                {confirmedCopy.returnQuestion}
              </Text>
              <Text style={styles.sub}>{copy.questionGuide}</Text>
            </View>
            <DeliveryStatus status="pending" amount={d.total} bankName={d.bankName} last4={d.last4} />
          </>
        )}

        <KeyValueCard
          rows={[
            { label: labels.kvStore, value: d.storeName },
            { label: labels.kvMenus, value: d.menuLine },
            { label: labels.kvAmount, value: d.totalLabel },
            { label: labels.kvDestination, value: d.accountLabel },
          ]}
        />

        {canCancel ? (
          <View style={styles.centered}>
            <TextButton size="sm" disabled={busy} onPress={() => setCancelSheet(true)}>
              {copy.cancelOrder}
            </TextButton>
          </View>
        ) : null}
      </ScrollView>

      {/* ORD-009 제안 문구 그대로. 취소는 SaveEats 주문 기록을 취소하는 것이지 송금 취소가 아니다 */}
      <ConfirmSheet
        visible={cancelSheet}
        onClose={() => setCancelSheet(false)}
        title={copy.cancelSheetTitle}
        descriptions={[copy.cancelSheetDesc]}
        secondary={{ label: copy.cancelSheetBack, onPress: () => setCancelSheet(false) }}
        primary={{
          label: copy.cancelSheetConfirm,
          onPress: () => {
            setCancelSheet(false);
            void cancelOrder();
          },
        }}
      />
    </Screen>
  );
}

/** 주문 상태 조회 실패. 재송금을 안내하지 않고, 외부 앱을 다시 열지도 않는다 (TRF-008) */
export function StatusErrorScreen() {
  return (
    <Screen top={<TopNavigation />}>
      <View style={styles.errorTop}>
        <ErrorState title={confirmedCopy.statusQueryFailedTitle} description={copy.statusErrorDesc} onRetry={() => startReturnCheck('replace')} />
        <View style={styles.centered}>
          <TextButton onPress={goHistory}>{copy.toHistory}</TextButton>
        </View>
      </View>
    </Screen>
  );
}

/** '아직이에요' 이후. 주문은 PENDING으로 남는다. 실패도 취소도 아니고, 자동으로 만료되지 않는다 (미결정 묶음2 #7) */
export function NotYetScreen() {
  const order = useCurrentOrder();
  if (!order) return null;
  const d = displayOf(order);

  return (
    <Screen
      top={<TopNavigation onClose={goHome} />}
      bottom={<ActionStack primary={{ label: copy.notYetResume, onPress: resumeCurrentOrder }} sub={{ label: copy.toHistory, onPress: goHistory }} />}>
      <ScrollView contentContainerStyle={styles.content}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            {copy.notYetTitle}
          </Text>
          <Text style={styles.sub}>{copy.notYetDesc}</Text>
        </View>
        <DeliveryStatus status="pending" amount={d.total} bankName={d.bankName} last4={d.last4} />
      </ScrollView>
    </Screen>
  );
}

/**
 * 주문 완료. 서버에 USER_CONFIRMED가 저장된 뒤에만 여기에 온다.
 * 완료는 사용자 확인이므로 "검증 완료"·"은행 확인" 같은 표현을 쓰지 않는다. 이모지는 이 헤더만 예외다 (기획서 22).
 */
export function DoneScreen() {
  const order = useCurrentOrder();
  if (!order) return null;
  const d = displayOf(order);

  return (
    <Screen
      top={<TopNavigation onClose={goHome} />}
      bottom={<ActionStack primary={{ label: copy.doneReview, onPress: goReviewWrite }} secondary={{ label: copy.toHistory, onPress: goHistory }} />}>
      <ScrollView contentContainerStyle={styles.doneContent}>
        <Text accessibilityRole="header" style={styles.doneHeader}>
          {copy.doneHeader}
        </Text>
        <DeliveryStatus status="delivered" large amount={d.total} bankName={d.bankName} last4={d.last4} />
        <View style={styles.doneCard}>
          <KeyValueCard
            rows={[
              { label: labels.kvStore, value: d.storeName },
              { label: labels.kvMenus, value: d.menuLine },
              { label: labels.kvAmount, value: d.totalLabel },
              { label: labels.kvDelivered, value: d.accountLabel },
            ]}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

/** 주문 취소 후. 서버에 CANCELLED가 저장된 뒤에만 보인다. 보낸 돈이 없다고 단정하지 않는다 (ORD-009) */
export function CancelledScreen() {
  const order = useCurrentOrder();
  if (!order) return null;
  const d = displayOf(order);

  return (
    <Screen top={<TopNavigation onClose={goHome} />} bottom={<ActionStack secondary={{ label: copy.toHistory, onPress: goHistory }} />}>
      <ScrollView contentContainerStyle={styles.content}>
        <DeliveryStatus status="cancelled" />
        <Text style={styles.sub}>{copy.cancelledDesc}</Text>
        <KeyValueCard
          rows={[
            { label: labels.kvStore, value: d.storeName },
            { label: labels.kvMenus, value: d.menuLine },
            { label: labels.kvAmount, value: d.totalLabel },
          ]}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  centerTop: {
    paddingTop: 160,
  },
  errorTop: {
    paddingTop: spacing[10],
  },
  centered: {
    alignItems: 'center',
  },
  title: {
    ...text.h1,
    color: colors.ink,
  },
  sub: {
    ...text.body1,
    color: colors.inkSecondary,
    marginTop: spacing[1],
  },
  doneContent: {
    paddingBottom: spacing[6],
  },
  doneHeader: {
    ...font('700'),
    fontSize: 28,
    lineHeight: 36,
    letterSpacing: -0.56,
    color: colors.ink,
    textAlign: 'center',
    paddingTop: spacing[6],
  },
  doneCard: {
    paddingHorizontal: spacing[5],
  },
});
