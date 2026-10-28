import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { TextButton } from '@/components/ui/button';
import { ListGroup, type ListRowSpec } from '@/components/ui/list-group';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { logout } from '@/features/auth/session-lifecycle';
import { goHowTo, goLogin, goNotificationSettings } from '@/features/order/flow-routes';
import { useAsync } from '@/hooks/use-async';
import { myService } from '@/services';
import { useSession } from '@/services/session';
import { spacing } from '@/theme';

const copy = draftCopy.settings;

/** 앱 버전은 빌드 정보(app.json의 version)에서 읽는다. 읽지 못하면 줄에 값을 비워 둔다 */
const APP_VERSION = Constants.expoConfig?.version ?? '';

/**
 * 설정 (㉖). 항목은 기획서 60 · FR-SET-001 그대로: 계정 정보 · 로그아웃 / 알림 설정 · SaveEats 이용 방법 /
 * 이용약관 · 개인정보 처리방침 · 앱 버전 / 회원 탈퇴.
 * Guest는 로그인 · 회원가입, 이용 방법, 약관, 앱 버전만 본다.
 *
 * 로그아웃은 확인 없이 바로 한다(미결정 묶음4 #3). 회원 탈퇴는 확인 시트까지만 만들고,
 * "탈퇴하기"를 눌러도 실제 탈퇴는 하지 않고 "준비 중" 화면으로만 보낸다 (탈퇴 후 처리 OPEN-DB-004 · 005 미결정).
 */
export function SettingsScreen() {
  const { isMember, userId } = useSession();
  const profile = useAsync(`settings:profile:${userId}`, () => (isMember ? myService.getProfile() : Promise.resolve(null)));
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const account: ListRowSpec[] = isMember
    ? [
        ...(profile.status === 'ok' && profile.data?.maskedName ? [{ key: 'name', label: copy.name, value: profile.data.maskedName }] : []),
        { key: 'email', label: copy.email, value: profile.status === 'ok' ? (profile.data?.maskedEmail ?? '') : '' },
        { key: 'logout', label: copy.logout, onPress: () => void logout() },
      ]
    : [{ key: 'login', label: copy.loginSignup, onPress: () => goLogin({ action: 'TAB', tab: 'settings' }) }];

  const general: ListRowSpec[] = [
    ...(isMember ? [{ key: 'notifications', label: copy.notifications, onPress: goNotificationSettings }] : []),
    // 온보딩 다시 보기는 여기서만 (미결정 묶음4 #8)
    { key: 'howto', label: copy.howTo, onPress: goHowTo },
  ];

  // 이용약관 · 개인정보 처리방침 본문은 아직 없다. 각각 따로 만든 "준비 중" 화면으로 간다
  const info: ListRowSpec[] = [
    { key: 'terms', label: copy.terms, onPress: () => router.push('/terms') },
    { key: 'privacy', label: copy.privacy, onPress: () => router.push('/privacy') },
    { key: 'version', label: copy.version, value: APP_VERSION },
  ];

  return (
    <Screen top={<TopNavigation title={copy.title} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />}>
      <ScrollView contentContainerStyle={styles.content}>
        <ListGroup title={isMember ? copy.groupAccount : copy.groupAccountGuest} rows={account} />
        <ListGroup title={copy.groupGeneral} rows={general} />
        <ListGroup title={copy.groupInfo} rows={info} />
        {isMember ? (
          <View style={styles.foot}>
            <TextButton size="sm" onPress={() => setWithdrawOpen(true)}>
              {copy.withdraw}
            </TextButton>
          </View>
        ) : null}
      </ScrollView>

      <ConfirmSheet
        visible={withdrawOpen}
        onClose={() => setWithdrawOpen(false)}
        title={copy.withdrawTitle}
        descriptions={[...copy.withdrawDescs]}
        secondary={{ label: copy.withdrawCancel, onPress: () => setWithdrawOpen(false) }}
        danger
        primary={{
          label: copy.withdrawConfirm,
          onPress: () => {
            // 실제 탈퇴 처리는 하지 않는다. 시트를 닫고 "준비 중" 화면으로만 보낸다
            setWithdrawOpen(false);
            router.push('/withdraw');
          },
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing[5], gap: spacing[6] },
  foot: { alignItems: 'center' },
});
