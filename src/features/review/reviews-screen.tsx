import { router } from 'expo-router';
import { ScrollView } from 'react-native';

import { ErrorState } from '@/components/ui/feedback-states';
import { Screen } from '@/components/ui/screen';
import { TopNavigation } from '@/components/ui/top-navigation';
import { confirmedCopy } from '@/config/confirmed-copy';
import { UNDECIDED } from '@/config/undecided';
import type { ReviewScope } from '@/mocks/history/types';

import { ReviewListSection } from './review-list-section';

/**
 * SaveEats 리뷰 화면 (가게 또는 메뉴 범위). 제목은 어느 쪽이든 "SaveEats 리뷰" 하나다.
 * 목록 본문은 가게 상세의 리뷰 탭과 같은 ReviewListSection이다. 범위를 읽을 수 없는 주소면 오류로 보여준다.
 */
export function ReviewsScreen({ scope }: { scope: ReviewScope | null }) {
  const top = <TopNavigation title={confirmedCopy.reviewTitle} onBack={() => router.back()} />;
  if (!scope) {
    return (
      <Screen top={top}>
        <ErrorState onRetry={() => router.back()} />
      </Screen>
    );
  }
  return (
    <Screen top={top}>
      <ScrollView>
        <ReviewListSection scope={scope} reportEnabled={UNDECIDED.reviewReportEntries.reviewListScreen} />
      </ScrollView>
    </Screen>
  );
}
