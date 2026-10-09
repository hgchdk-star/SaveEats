import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { AccountDestinationCard } from '@/components/ui/account-destination-card';
import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { SecondaryButton } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { UNDECIDED } from '@/config/undecided';
import { useOrderFlowStore } from '@/features/order/order-flow-store';
import { showToast } from '@/features/toast/toast-store';
import { accountService } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

const copy = draftCopy.account;

/** 돈이 배달될 계좌: 등록된 계좌 보기, 변경, 삭제. 계좌는 지금 1개만 등록할 수 있다 (기획서 10) */
export function AccountScreen() {
  const { destinationAccount } = useSession();
  const hasPendingOrder = useOrderFlowStore((s) => s.order?.status === 'PENDING');
  const [deleting, setDeleting] = useState(false);
  const [sheet, setSheet] = useState(false);

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goForm = (mode: 'register' | 'change') => router.push({ pathname: '/account/form', params: { mode, from: 'manage' } });

  const remove = async () => {
    if (!destinationAccount || deleting) return;
    setDeleting(true);
    try {
      await accountService.deleteDestinationAccount(destinationAccount.id);
      setSheet(false);
      showToast({ message: copy.toastDeleted });
    } catch {
      showToast({ message: draftCopy.cart.saveFailed, tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  // 미결정 묶음2 #4: 진행 중인 주문이 있어도 막지 않고 안내만 한다. 진행 중인 주문은 주문 당시 계좌로 이어간다
  const showPendingNotice = !!destinationAccount && hasPendingOrder && UNDECIDED.pendingOrderAccountChange === 'allowWithNotice';

  return (
    <Screen top={<TopNavigation divider title={copy.manageTitle} onBack={goBack} />}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* 계좌가 없으면 카드를 눌러 등록한다 */}
        <AccountDestinationCard account={destinationAccount} onPress={destinationAccount ? undefined : () => goForm('register')} />

        {destinationAccount ? (
          <View style={styles.buttons}>
            <View style={styles.button}>
              <SecondaryButton block onPress={() => goForm('change')}>
                {copy.change}
              </SecondaryButton>
            </View>
            <View style={styles.button}>
              <SecondaryButton block onPress={() => setSheet(true)}>
                {copy.remove}
              </SecondaryButton>
            </View>
          </View>
        ) : null}

        {showPendingNotice ? <Notice flush icon="clock" title={copy.pendingOrderNotice} /> : null}

        <Text style={styles.help}>{copy.manageHelp}</Text>
      </ScrollView>

      <ConfirmSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={copy.deleteTitle}
        descriptions={[copy.deleteDesc, ...(hasPendingOrder ? [copy.pendingOrderNotice] : [])]}
        secondary={{ label: '취소', onPress: () => setSheet(false) }}
        primary={{ label: copy.deleteConfirm, onPress: () => void remove() }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  buttons: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  button: {
    flex: 1,
  },
  help: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
  },
});
