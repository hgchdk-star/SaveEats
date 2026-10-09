import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { ErrorState, Spinner } from '@/components/ui/feedback-states';
import { ListGroup } from '@/components/ui/list-group';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { showToast } from '@/features/toast/toast-store';
import type { MockNotificationSettings, NotificationType } from '@/mocks/my/types';
import { myService } from '@/services';
import { colors, spacing, text } from '@/theme';

const copy = draftCopy.notifications;

type Load = { status: 'loading' } | { status: 'error' } | { status: 'ok'; values: MockNotificationSettings };

/**
 * 알림 설정 (㉖). 유형별 ON/OFF를 한 화면에서 (미결정 묶음4 #5): 주문 상태 · 작성할 수 있는 리뷰 · 월간 기록.
 * 서비스 이용에 꼭 필요한 안내는 끌 수 없고, 혜택 · 추천(마케팅) 알림은 따로 관리하며 이번에 없다 (PRD 45).
 * 알림함과 푸시 발송은 만들지 않는다. 스위치는 설정값을 저장할 뿐이다. 리뷰 알림과 내역의 빨간 점은 별개다.
 * 스위치는 먼저 바꾸고 목표값을 저장한다. 저장에 실패하면 되돌리고 토스트로 알린다.
 */
export function NotificationsScreen() {
  const [state, setState] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    myService.getNotificationSettings().then(
      (values) => {
        if (alive) setState({ status: 'ok', values });
      },
      () => {
        if (alive) setState({ status: 'error' });
      },
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const toggle = (type: NotificationType) => (enabled: boolean) => {
    if (state.status !== 'ok') return;
    const before = state.values[type];
    setState({ status: 'ok', values: { ...state.values, [type]: enabled } });
    myService.updateNotificationSetting({ type, enabled }).catch(() => {
      setState((current) => (current.status === 'ok' ? { status: 'ok', values: { ...current.values, [type]: before } } : current));
      showToast({ message: copy.saveFailed, tone: 'error' });
    });
  };

  const top = <TopNavigation title={copy.title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;

  if (state.status === 'loading') {
    return (
      <Screen top={top}>
        <Spinner label={copy.loading} />
      </Screen>
    );
  }
  if (state.status === 'error') {
    return (
      <Screen top={top}>
        <ErrorState
          title={copy.errorTitle}
          onRetry={() => {
            setState({ status: 'loading' });
            setAttempt((n) => n + 1);
          }}
        />
      </Screen>
    );
  }

  const v = state.values;
  return (
    <Screen top={top}>
      <ScrollView contentContainerStyle={styles.content}>
        <ListGroup title={copy.groupOrder} rows={[{ key: 'orderStatus', label: copy.orderStatus, desc: copy.orderStatusDesc, on: v.orderStatus, onToggle: toggle('orderStatus') }]} />
        <ListGroup
          title={copy.groupRecord}
          rows={[
            { key: 'reviewAvailable', label: copy.reviewAvailable, desc: copy.reviewAvailableDesc, on: v.reviewAvailable, onToggle: toggle('reviewAvailable') },
            { key: 'monthlyRecord', label: copy.monthlyRecord, desc: copy.monthlyRecordDesc, on: v.monthlyRecord, onToggle: toggle('monthlyRecord') },
          ]}
        />
        {copy.footer.map((line) => (
          <Text key={line} style={styles.footer}>
            {line}
          </Text>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[5], gap: spacing[6] },
  footer: { ...text.body2, color: colors.inkTertiary, marginTop: -spacing[4] },
});
