import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { CtaBar } from '@/components/ui/cta-bar';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { TopNavigation } from '@/components/ui/top-navigation';
import { LIMITS } from '@/config/limits';
import { draftCopy } from '@/config/draft-copy';
import { showToast } from '@/features/toast/toast-store';
import { myService } from '@/services';
import { colors, spacing, text } from '@/theme';
import { checkNickname } from '@/utils/nickname';

import { useLoginIntentStore } from './login-intent-store';
import { nicknameProblemText, saveFailureKind } from './nickname-copy';
import { clearProfileSetupPending, loadProfileSetupPending } from './profile-setup-pending';
import { resumeAfterLogin } from './resume-intent';

const copy = draftCopy.nickname;

/**
 * recover: 가입은 됐는데 닉네임 저장이 끝나지 않은 계정. 같은 계정의 프로필 저장만 다시 시도하고 회원가입은 부르지 않는다.
 *          "계정은 만들어졌어요" 안내는 이 모드에서만 보여 준다.
 * set:     닉네임이 없는 기존 계정이 설정에서 처음 정할 때. 제목은 recover와 같고 가입 직후 안내는 없다.
 * change:  닉네임이 있는 계정이 바꿀 때. 제목은 "닉네임 변경"이고 현재 닉네임을 채워서 연다.
 */
export type ProfileSetupMode = 'recover' | 'set' | 'change';

export function ProfileSetupScreen({ mode }: { mode: ProfileSetupMode }) {
  const recover = mode === 'recover';
  const change = mode === 'change';
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [failure, setFailure] = useState<'network' | 'unexpected' | null>(null);
  const [busy, setBusy] = useState(false);
  const touched = useRef(false);

  // 이어서 하는 경우 작성했던 닉네임을, 바꾸는 경우 지금 닉네임을 채워 둔다. 사용자가 이미 입력했다면 덮어쓰지 않는다
  useEffect(() => {
    let cancelled = false;
    const prefill = async () => {
      const next = recover ? (await loadProfileSetupPending())?.nickname : change ? await myService.getProfile().then((p) => p.nickname, () => null) : null;
      if (!cancelled && next && !touched.current) setValue(next);
    };
    void prefill();
    return () => {
      cancelled = true;
    };
  }, [recover, change]);

  const close = () => {
    if (busy) return;
    if (recover) useLoginIntentStore.getState().setIntent(null);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submit = async () => {
    if (busy) return;
    const checked = checkNickname(value);
    if (!checked.ok) {
      setError(nicknameProblemText(checked.problem));
      return;
    }
    setBusy(true);
    setError(undefined);
    setFailure(null);
    try {
      await myService.saveNickname(checked.value);
    } catch (e) {
      setBusy(false);
      const kind = saveFailureKind(e);
      if (kind === 'invalid') setError(copy.errorServerRejected);
      else setFailure(kind);
      return;
    }
    setBusy(false);
    await clearProfileSetupPending();
    if (recover) {
      const { intent, setIntent } = useLoginIntentStore.getState();
      setIntent(null);
      resumeAfterLogin(intent);
    } else if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
    showToast({ message: change ? copy.toastChanged : copy.toastSaved });
  };

  const notice = failure === 'network' ? copy.setupFailedNetwork : failure === 'unexpected' ? copy.setupFailedUnexpected : recover ? copy.setupFailedAfterSignup : null;

  return (
    <Screen
      avoidKeyboard
      top={<TopNavigation onClose={close} leadingDisabled={busy} />}
      bottom={<CtaBar label={busy ? copy.setupSaving : recover ? copy.setupRetry : copy.saveCta} loading={busy} onPress={() => void submit()} />}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          {change ? copy.changeTitle : copy.setupTitle}
        </Text>

        {notice ? <Notice flush tone="danger" title={notice} /> : null}

        <View>
          <TextInput
            label={copy.label}
            value={value}
            onChangeText={(v) => {
              touched.current = true;
              setValue(v);
              setError(undefined);
            }}
            placeholder={copy.placeholder}
            autoComplete="off"
            maxLength={LIMITS.nicknameMaxLength + 4}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            helper={copy.help}
            error={error}
            disabled={busy}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing[5],
    gap: spacing[5],
  },
  title: {
    ...text.h1,
    color: colors.ink,
  },
});
