import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ConfirmSheet } from '@/components/ui/bottom-sheet';
import { CtaBar } from '@/components/ui/cta-bar';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { clearDeviceDataAfterWithdrawal } from '@/features/auth/session-lifecycle';
import { showToast } from '@/features/toast/toast-store';
import { authService } from '@/services';
import { ServiceError, errorCode } from '@/services/service-error';
import { getSession, useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

const copy = draftCopy.withdraw;

type Failure = 'wrongPassword' | 'failed' | 'unknown' | null;

/**
 * 회원 탈퇴. 지워지는 항목을 먼저 보여 주고, 비밀번호를 다시 입력받은 뒤, 마지막으로 한 번 더 확인한다.
 * 서버 delete_my_account()가 성공하면(이미 지워진 계정도 성공) 이 기기의 계좌·장바구니·최근 기록·세션을 지운다.
 * 비밀번호는 이 화면의 state에만 있고 저장·로그에 남기지 않는다. 탈퇴 성공 뒤에는 서버를 더 부르지 않는다.
 */
export function WithdrawScreen() {
  const { isMember } = useSession();
  const [password, setPassword] = useState('');
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  // 비밀번호 확인이 끝났으면, 탈퇴 요청만 실패한 재시도에서는 다시 확인하지 않는다(응답이 유실돼 계정이 이미 지워졌을 수 있다)
  const [verified, setVerified] = useState(false);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const askConfirm = () => {
    if (busy) return;
    if (!password && !verified) {
      setShowEmpty(true);
      return;
    }
    setSheet(true);
  };

  const withdraw = async () => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    const userId = getSession().userId;
    try {
      if (!verified) {
        await authService.verifyPassword(password);
        setVerified(true);
      }
      await authService.deleteAccount();
    } catch (error) {
      setBusy(false);
      const code = errorCode(error);
      if (code === 'INVALID_CREDENTIALS') setFailure('wrongPassword');
      else if (code === 'WITHDRAW_FAILED') setFailure('failed');
      else setFailure(error instanceof ServiceError && error.outcomeUnknown ? 'unknown' : 'failed');
      return;
    }
    setPassword('');
    const cleared = await clearDeviceDataAfterWithdrawal(userId);
    setBusy(false);
    router.dismissAll();
    router.navigate('/');
    showToast(cleared ? { message: copy.done } : { message: copy.doneKept, tone: 'error' });
  };

  if (!isMember && !busy) {
    // 로그인 상태가 아니면 탈퇴할 계정이 없다. 탈퇴를 마치고 로그아웃된 직후의 화면 전환도 여기로 온다
    return (
      <Screen top={<TopNavigation title={copy.title} onBack={close} />}>
        <View />
      </Screen>
    );
  }

  return (
    <Screen
      avoidKeyboard
      top={<TopNavigation divider title={copy.title} onBack={close} leadingDisabled={busy} />}
      bottom={<CtaBar label={copy.cta} loading={busy} onPress={askConfirm} />}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          {copy.heading}
        </Text>
        <Text style={styles.lead}>{copy.lead}</Text>

        <View style={styles.list}>
          {copy.items.map((item) => (
            <View key={item} style={styles.row}>
              <Text style={styles.bullet}>•</Text>
              <Text style={styles.rowText}>{item}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.note}>{copy.transferNote}</Text>

        {failure === 'failed' ? <Notice flush tone="danger" title={copy.failedTitle} description={copy.failedDesc} /> : null}
        {failure === 'unknown' ? <Notice flush tone="danger" title={copy.unknownTitle} description={copy.unknownDesc} /> : null}

        <TextInput
          label={copy.passwordLabel}
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setShowEmpty(false);
            if (failure === 'wrongPassword') setFailure(null);
          }}
          secure
          autoComplete="password"
          autoCapitalize="none"
          helper={copy.passwordHelper}
          disabled={busy || verified}
          error={failure === 'wrongPassword' ? copy.passwordWrong : showEmpty && !password && !verified ? copy.passwordEmpty : undefined}
          returnKeyType="done"
          onSubmitEditing={askConfirm}
        />
      </ScrollView>

      <ConfirmSheet
        visible={sheet}
        onClose={() => setSheet(false)}
        title={copy.sheetTitle}
        descriptions={[copy.sheetDesc]}
        secondary={{ label: copy.sheetBack, onPress: () => setSheet(false) }}
        primary={{
          label: copy.sheetConfirm,
          onPress: () => {
            setSheet(false);
            void withdraw();
          },
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[4],
  },
  heading: {
    ...text.h1,
    color: colors.ink,
  },
  lead: {
    ...text.body1,
    color: colors.inkSecondary,
  },
  list: {
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  row: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  bullet: {
    ...text.body1,
    color: colors.ink,
  },
  rowText: {
    flex: 1,
    ...text.body1,
    color: colors.ink,
  },
  note: {
    ...text.body2,
    color: colors.inkSecondary,
  },
});
