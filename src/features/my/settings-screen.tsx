import Constants from 'expo-constants';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
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
const nicknameCopy = draftCopy.nickname;

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

  // 프로필 설정에서 닉네임을 저장하고 돌아오면 다시 불러온다(처음 한 번은 제외)
  const first = useRef(true);
  const reloadProfile = profile.reload;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reloadProfile();
    }, [reloadProfile]),
  );

  // 닉네임 줄: 조회 실패는 닉네임 없음과 구분한다(이메일·실명으로 대신하지 않는다). 없으면 "설정하기"로 프로필 설정에 연결한다
  const currentNickname = profile.status === 'ok' ? (profile.data?.nickname ?? null) : null;
  const nicknameRow: ListRowSpec | null =
    profile.status === 'error'
      ? // 조회에 실패한 동안에는 설정하기/변경으로 연결하지 않는다. 다시 불러오기만 한다
        { key: 'nickname', label: nicknameCopy.settingsRow, desc: nicknameCopy.loadFailed, value: nicknameCopy.loadRetry, onPress: profile.reload }
      : profile.status === 'ok' && profile.data
        ? {
            key: 'nickname',
            label: nicknameCopy.settingsRow,
            // 닉네임이 있으면 현재 값을 아래에 보여 주고 "변경", 없으면 "설정하기"
            ...(profile.data.nickname ? { desc: profile.data.nickname } : {}),
            value: profile.data.nickname ? nicknameCopy.settingsRowChange : nicknameCopy.settingsRowSet,
            onPress: () => router.push({ pathname: '/profile-setup', params: { mode: currentNickname ? 'change' : 'set' } }),
          }
        : null;

  const account: ListRowSpec[] = isMember
    ? [
        ...(nicknameRow ? [nicknameRow] : []),
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
  foot: { flexDirection: 'row', justifyContent: 'center' },
});
