import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Logo } from '@/components/ui/logo';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { colors, spacing, text } from '@/theme';

import { shouldShowOnboarding } from './onboarding-storage';

/**
 * 앱 실행 절차 (㉗ Splash, FR-SPL-001~004): Splash → (처음 실행이면) 온보딩 → 홈. 다시 실행하면 온보딩 없이 홈.
 * Splash 동안 로그인이나 계좌를 묻지 않는다. 최소 표시 시간(LIMITS.splashMinMs)은 PRD 1.9가 미정이라 시안 값이다.
 *
 * 홈(탭)이 늘 스택의 첫 화면이다. 처음 실행이면 Splash가 덮인 채로 온보딩 화면을 홈 위에서 바꿔 끼운다(replace).
 * 그러면 온보딩을 끝낸 뒤 홈으로 가는 길이 하나로 정해진다.
 */
export function LaunchGate() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let alive = true;
    const startedAt = Date.now();
    void shouldShowOnboarding().then((showOnboarding) => {
      const wait = Math.max(0, LIMITS.splashMinMs - (Date.now() - startedAt));
      setTimeout(() => {
        if (!alive) return;
        if (showOnboarding) router.replace('/onboarding');
        setVisible(false);
      }, wait);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!visible) return null;

  return (
    <View accessibilityViewIsModal style={styles.splash}>
      <Logo />
      {/* 아래 줄은 온보딩 3페이지 제목을 다시 쓴다 */}
      <Text style={styles.sub}>{draftCopy.start.splashSub}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  splash: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.bg,
  },
  sub: {
    ...text.body1,
    color: colors.inkSecondary,
  },
});
