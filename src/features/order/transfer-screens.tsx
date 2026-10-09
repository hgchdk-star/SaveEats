import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { SecondaryButton } from '@/components/ui/button';
import { CopyCard } from '@/components/ui/copy-row';
import { CtaBar, QuestionBar } from '@/components/ui/cta-bar';
import { DeliveryStatus } from '@/components/ui/delivery-status';
import { Notice } from '@/components/ui/notice';
import { OptionSheet } from '@/components/ui/option-sheet';
import { KeyValueCard } from '@/components/ui/order-info';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';
import { colors, spacing, text } from '@/theme';

import { confirmOrder, copyAccountNumber, copyAmount, notYet, openTossFromContinue, openTossPlain } from './order-actions';
import { displayOf } from './order-display';
import { goHistory } from './flow-routes';
import { useOrderFlowStore } from './order-flow-store';
import { useCurrentOrder } from './use-current-order';

const copy = draftCopy.transfer;

/**
 * 주문 이어가기 (토스).
 * PENDING 저장에 성공한 뒤에만 여기에 온다. 같은 orderId를 유지하고, 외부 앱은 버튼을 눌렀을 때만 연다 (TRF-006).
 */
export function ContinueScreen() {
  const order = useCurrentOrder();
  const tossBusy = useOrderFlowStore((s) => s.transfer.tossBusy);
  const [sheet, setSheet] = useState(false);
  if (!order) return null;
  const d = displayOf(order);

  return (
    <Screen
      top={<TopNavigation divider title={copy.continueTitle} onClose={goHistory} />}
      bottom={
        <CtaBar
          label={copy.continueCta}
          loading={tossBusy}
          onPress={() => void openTossFromContinue()}
          sub={{ label: draftCopy.confirm.otherWay, onPress: () => setSheet(true), disabled: tossBusy }}
        />
      }>
      <ScrollView contentContainerStyle={styles.content}>
        <DeliveryStatus status="pending" amount={d.total} bankName={d.bankName} last4={d.last4} />
        <Text style={styles.guide}>{copy.continueGuide}</Text>
        <KeyValueCard
          rows={[
            { label: copy.kvStore, value: d.storeName },
            { label: copy.kvMenus, value: d.menuLine },
            { label: copy.kvAmount, value: d.totalLabel },
          ]}
        />
      </ScrollView>

      <OptionSheet
        visible={sheet}
        title={copy.otherWaySheetTitle}
        onClose={() => setSheet(false)}
        options={[
          {
            title: copy.otherWayOptionTitle,
            sub: copy.otherWayOptionSub,
            onPress: () => {
              setSheet(false);
              useOrderFlowStore.getState().setTransfer({ tossFailed: false });
              router.replace('/order/direct');
            },
          },
        ]}
      />
    </Screen>
  );
}

/**
 * 직접 주문 이어가기. 계좌번호와 금액을 복사해서 사용 중인 금융앱에서 보낸다 (TRF-007).
 * 복사는 각 버튼을 눌렀을 때만 일어난다. 화면에 들어올 때나 앱에 돌아올 때 자동으로 복사하지 않는다.
 */
export function DirectScreen() {
  const order = useCurrentOrder();
  const transfer = useOrderFlowStore((s) => s.transfer);
  const busy = useOrderFlowStore((s) => s.work === 'CONFIRM_SYNCING');
  if (!order) return null;
  const d = displayOf(order);

  // 토스 이어가기를 거쳐 온 경우에만 뒤로 갈 수 있다. 원격 설정이 꺼져서 바로 온 경우에는 닫기(내역)만 있다
  const cameFromContinue = transfer.tossConfigEnabled;
  const leading = cameFromContinue
    ? { onBack: () => router.replace('/order/continue') }
    : { onClose: goHistory };

  return (
    <Screen
      top={<TopNavigation divider title={copy.directTitle} {...leading} />}
      bottom={
        <QuestionBar
          question={confirmedCopy.returnQuestion}
          left={{ label: draftCopy.result.notYet, onPress: notYet, disabled: busy }}
          right={{ label: draftCopy.result.confirmDone, onPress: () => void confirmOrder({ navigateToQuestion: true }), loading: busy, disabled: busy }}
        />
      }>
      <ScrollView contentContainerStyle={styles.content}>
        {transfer.tossFailed ? <Notice flush title={confirmedCopy.tossLaunchFailed} /> : null}

        <Text style={styles.guideDirect}>{confirmedCopy.directGuide}</Text>

        <CopyCard>
          {transfer.rawAvailable ? (
            <CopyCard.Row label={copy.destinationLabel} value={d.accountLabel} action={{ label: copy.copyAccount, onPress: () => void copyAccountNumber() }} />
          ) : (
            // 원문을 확인하지 못하면 복사를 막고 다시 확인하게 한다. 마스킹 번호를 대신 복사하지 않는다
            <CopyCard.Row
              label={copy.destinationLabel}
              value={d.accountLabel}
              error={copy.rawUnavailable}
              action={{ label: copy.rawRetry, icon: 'refresh', onPress: () => void copyAccountNumber() }}
            />
          )}
          <CopyCard.Row label={copy.amountLabel} value={d.totalLabel} action={{ label: copy.copyAmount, onPress: () => void copyAmount() }} />
        </CopyCard>

        <SecondaryButton block onPress={() => void openTossPlain()}>
          {copy.openToss}
        </SecondaryButton>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  guide: {
    ...text.body1,
    color: colors.inkSecondary,
  },
  guideDirect: {
    ...text.body1,
    color: colors.inkSecondary,
  },
});
