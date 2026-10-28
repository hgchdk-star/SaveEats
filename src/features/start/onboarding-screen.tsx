import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CtaBar } from '@/components/ui/cta-bar';
import { OnboardingPager, type OnboardingPage } from '@/components/ui/onboarding-pager';
import { Screen } from '@/components/ui/screen';
import { TextButton } from '@/components/ui/button';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { draftCopy } from '@/config/draft-copy';

import { markOnboardingSeen } from './onboarding-storage';

const copy = draftCopy.start;
const ARTS = ['browse', 'deliver', 'start'] as const;

/** 제목은 기획서 44 · FR-ONB-003 그대로(확정), 설명은 초안 문구 */
const PAGES: OnboardingPage[] = confirmedCopy.onboardingTitles.map((title, i) => ({ key: `p${i}`, title, desc: copy.onboardingDescs[i], art: ARTS[i] }));

/**
 * 온보딩 3페이지(처음 실행)와 SaveEats 이용 방법(설정에서 다시 보기)이 같은 화면이다 (미결정 묶음4 #8).
 *
 * first: 건너뛰기 가능, 마지막 'SaveEats 시작하기' 또는 건너뛰기 → 저장하고 홈. 로그인 · 계좌를 강제하지 않는다.
 *        건너뛰어도 최종 주문 확인의 '음식은 주문되지 않아요' 고지는 항상 다시 나온다 (FR-ONB-008).
 * howto: 건너뛰기 없음, 마지막 '확인' → 설정으로 돌아간다. 완료 여부를 다시 저장하지 않는다.
 */
export function OnboardingScreen({ mode }: { mode: 'first' | 'howto' }) {
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;
  const howto = mode === 'howto';

  const finish = async () => {
    await markOnboardingSeen();
    router.replace('/');
  };

  const next = () => {
    if (!last) setPage(page + 1);
    else if (howto) router.back();
    else void finish();
  };

  const top = howto ? (
    <TopNavigation title={copy.howToTitle} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
  ) : (
    <TopNavigation
      actions={
        !last ? (
          <TextButton size="sm" onPress={() => void finish()}>
            {copy.skip}
          </TextButton>
        ) : undefined
      }
    />
  );

  return (
    <Screen top={top} bottom={<CtaBar label={howto ? (last ? copy.howToConfirm : copy.next) : last ? confirmedCopy.onboardingStart : copy.next} onPress={next} />}>
      <View style={styles.body}>
        <OnboardingPager pages={PAGES} page={page} onPageChange={setPage} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
});
