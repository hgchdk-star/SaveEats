import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/ui/button';
import { CtaBar } from '@/components/ui/cta-bar';
import { Notice } from '@/components/ui/notice';
import { Screen } from '@/components/ui/screen';
import { TextInput } from '@/components/ui/text-input';
import { TopNavigation } from '@/components/ui/top-navigation';
import { LIMITS } from '@/config/limits';
import { draftCopy } from '@/config/draft-copy';
import { showToast } from '@/features/toast/toast-store';
import { authService } from '@/services';
import { errorCode } from '@/services/service-error';
import { colors, spacing, text } from '@/theme';

import { useLoginIntentStore, type LoginIntent } from './login-intent-store';
import { resumeAfterLogin } from './resume-intent';

type Mode = 'login' | 'signup';
type FormError = { email?: string; password?: string };

const copy = draftCopy.login;

function reasonFor(intent: LoginIntent | null): string {
  switch (intent?.action) {
    case 'ORDER':
      return copy.reasonOrder;
    case 'FAVORITE':
      return copy.reasonFavorite;
    case 'ACCOUNT':
      return copy.reasonAccount;
    case 'HISTORY':
      return draftCopy.history.reasonHistory;
    case 'HELPFUL':
      return draftCopy.review.helpfulLoginReason;
    default:
      return copy.reasonDefault;
  }
}

/** 형식만 본다. 이메일이 실제로 있는지, 비밀번호가 맞는지는 서버가 판단한다 */
function validate(mode: Mode, email: string, password: string): FormError {
  const errors: FormError = {};
  const trimmed = email.trim();
  if (trimmed.indexOf('@') < 1 || trimmed.indexOf('.') < 0) errors.email = copy.emailError;
  if (!password) errors.password = copy.passwordError;
  else if (mode === 'signup' && password.length < LIMITS.passwordMinLength) errors.password = copy.passwordTooShort;
  return errors;
}

export function LoginScreen() {
  const intent = useLoginIntentStore((s) => s.intent);
  const setIntent = useLoginIntentStore((s) => s.setIntent);
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<FormError>({});
  const [failure, setFailure] = useState<'credentials' | 'network' | null>(null);
  const [busy, setBusy] = useState(false);

  const signup = mode === 'signup';

  // 닫으면 하려던 행동을 버리고 원래 화면으로. Guest 장바구니는 그대로 둔다
  const close = () => {
    setIntent(null);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const submit = async () => {
    if (busy) return;
    const found = validate(mode, email, password);
    setErrors(found);
    if (found.email || found.password) return;

    setBusy(true);
    setFailure(null);
    try {
      await (signup ? authService.signUp : authService.signIn)({ email: email.trim(), password });
    } catch (error) {
      setBusy(false);
      // 인증 오류와 네트워크 오류를 다른 문구로 구분한다 (AUTH-002)
      setFailure(errorCode(error) === 'NETWORK_UNAVAILABLE' ? 'network' : 'credentials');
      return;
    }
    setBusy(false);
    setPassword(''); // 비밀번호는 성공하는 즉시 지운다
    setIntent(null);
    resumeAfterLogin(intent);
    showToast({ message: signup ? copy.toastSignedUp : copy.toastLoggedIn });
  };

  const switchMode = () => {
    setMode(signup ? 'login' : 'signup');
    setErrors({});
    setFailure(null);
  };

  return (
    <Screen
      avoidKeyboard
      top={<TopNavigation onClose={close} leadingDisabled={busy} />}
      bottom={
        <CtaBar
          label={signup ? copy.ctaSignup : copy.ctaLogin}
          loading={busy}
          onPress={() => void submit()}
          sub={{ label: signup ? copy.switchToLogin : copy.switchToSignup, onPress: switchMode, disabled: busy }}
        />
      }>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <View>
          <Text accessibilityRole="header" style={styles.title}>
            {signup ? copy.titleSignup : copy.titleLogin}
          </Text>
          <Text style={styles.reason}>{reasonFor(intent)}</Text>
        </View>

        {failure === 'credentials' ? (
          <Notice flush tone="danger" title={copy.failedTitle} description={copy.failedDesc} />
        ) : failure === 'network' ? (
          <Notice flush tone="danger" title={copy.networkFailedTitle} description={copy.failedDesc} />
        ) : null}

        <View style={styles.fields}>
          <TextInput
            label={copy.emailLabel}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setErrors((e) => ({ ...e, email: undefined }));
            }}
            placeholder={copy.emailPlaceholder}
            keyboardType="email-address"
            autoComplete="email"
            returnKeyType="next"
            error={errors.email}
            disabled={busy}
          />
          <TextInput
            label={copy.passwordLabel}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setErrors((e) => ({ ...e, password: undefined }));
            }}
            placeholder={copy.passwordPlaceholder}
            secure
            autoComplete={signup ? 'new-password' : 'password'}
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
            helper={signup ? copy.passwordHelpSignup : undefined}
            error={errors.password}
            disabled={busy}
          />
        </View>

        {!signup ? (
          <View style={styles.forgot}>
            {/* 비밀번호 재설정 화면은 아직 없다 (미결정 묶음2 #1). 링크만 두고 "준비 중" 화면으로 보낸다 */}
            <TextButton size="sm" onPress={() => router.push('/password-reset')}>
              {copy.forgotPassword}
            </TextButton>
          </View>
        ) : null}
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
  reason: {
    ...text.body1,
    color: colors.inkSecondary,
    marginTop: spacing[1],
  },
  fields: {
    gap: spacing[4],
  },
  forgot: {
    alignItems: 'flex-start',
    marginLeft: -spacing[2],
  },
});
