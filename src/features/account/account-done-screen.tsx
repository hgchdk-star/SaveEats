import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CtaBar } from '@/components/ui/cta-bar';
import { DeliveryStatus } from '@/components/ui/delivery-status';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

const copy = draftCopy.account;

/**
 * 계좌 등록 완료. 주문 중에 등록했다면 장바구니는 그대로 두고 최종 주문 확인으로 돌아간다.
 * 등록이 끝났다고 주문을 자동으로 만들지 않는다 (AUTH-003 #5).
 */
export function AccountDoneScreen({ fromOrder }: { fromOrder: boolean }) {
  const { destinationAccount } = useSession();

  return (
    <Screen
      top={<TopNavigation />}
      bottom={
        <CtaBar
          label={fromOrder ? copy.doneCtaOrder : copy.doneCtaManage}
          onPress={() => router.replace(fromOrder ? '/order/confirm' : '/account')}
        />
      }>
      <ScrollView contentContainerStyle={styles.content}>
        <DeliveryStatus status="registered" large bankName={destinationAccount?.bankName} last4={destinationAccount?.last4} />
        {fromOrder ? (
          <View>
            <Text style={styles.help}>{copy.doneFromOrderGuide}</Text>
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    paddingTop: spacing[10],
    gap: spacing[5],
  },
  help: {
    ...text.caption,
    fontSize: 13,
    lineHeight: 18,
    color: colors.inkTertiary,
    textAlign: 'center',
  },
});
