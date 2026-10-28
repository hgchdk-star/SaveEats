import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PrimaryButton, SecondaryButton } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback-states';
import { Screen } from '@/components/ui/screen';
import { StoreList } from '@/components/ui/store-list';
import { TopNavigation } from '@/components/ui/top-navigation';
import { draftCopy } from '@/config/draft-copy';
import { LIMITS } from '@/config/limits';
import { goLogin } from '@/features/order/flow-routes';
import { StoreCardItem } from '@/features/store/store-card-item';
import { usePagedStores } from '@/features/store/use-paged-stores';
import { catalogRepository } from '@/services';
import { useSession } from '@/services/session';
import { colors, spacing, text } from '@/theme';

import { useFavoritesStore } from './favorites-store';

const copy = draftCopy.favorites;

/**
 * 찜 (㉔). 로그인 사용자만 본다. 가게만 찜할 수 있고(FR-FAV-001) 최근 찜한 순서다.
 * 목록은 서버가 준 찜(활성 가게만) 위에 "내가 방금 바꾼 값"을 얹어 보여준다. 하트를 해제하면 목록에서 바로 빠지고
 * '되돌리기' 토스트로 같은 자리에 돌아온다. 운영하지 않는 가게는 찜해 두어도 서버가 목록에서 빼서 어디에도 보이지 않는다 (FR-FAV-006).
 */
export function FavoritesScreen() {
  const { isMember, userId } = useSession();
  const overrides = useFavoritesStore((s) => s.overrides);

  const favorites = usePagedStores(
    isMember ? `favorites:${userId}` : null,
    (cursor) => catalogRepository.listMyFavorites({ cursor, pageSize: LIMITS.storeListPageSize }),
    { keepStale: true },
  );

  // 다른 화면에서 찜한 가게가 목록에 들어오도록, 탭으로 돌아올 때마다 조용히 다시 받는다(처음 한 번은 제외)
  const first = useRef(true);
  const reload = favorites.reload;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      reload();
    }, [reload]),
  );

  const top = <TopNavigation title={copy.title} divider />;

  if (!isMember) {
    return (
      <Screen top={top}>
        <EmptyState icon="heart" title={copy.guestTitle} description={copy.guestDesc} action={<PrimaryButton onPress={() => goLogin({ action: 'TAB', tab: 'favorites' })}>{copy.guestAction}</PrimaryButton>} />
      </Screen>
    );
  }

  if (favorites.status === 'idle' || favorites.status === 'loading') {
    return (
      <Screen top={top}>
        <View accessibilityLabel="불러오는 중" style={styles.skeletons}>
          {[0, 1].map((i) => (
            <View key={i} style={styles.skelCard}>
              <View style={styles.skelImage} />
              <Skeleton width="55%" height={20} />
              <Skeleton width="80%" height={14} />
            </View>
          ))}
        </View>
      </Screen>
    );
  }

  if (favorites.status === 'error') {
    return (
      <Screen top={top}>
        <ErrorState title={copy.errorTitle} onRetry={favorites.reload} />
      </Screen>
    );
  }

  // 방금 해제한 가게는 서버 목록에 남아 있어도 보이지 않는다. 되돌리면 같은 자리로 돌아온다
  const shown = favorites.items.filter((store) => overrides[store.id] !== false);

  return (
    <Screen top={top}>
      {shown.length === 0 ? (
        <EmptyState icon="heart" title={copy.emptyTitle} description={copy.emptyDesc} action={<SecondaryButton onPress={() => router.navigate('/')}>{copy.emptyAction}</SecondaryButton>} />
      ) : (
        <StoreList
          data={shown}
          keyExtractor={(store) => store.id}
          countLabel={copy.count(shown.length)}
          onEndReached={favorites.loadMore}
          renderItem={(store) => <StoreCardItem store={store} fromFavoritesList />}
          footer={
            favorites.more === 'error' ? (
              <View style={styles.footerRow}>
                <Text style={styles.footerText}>{draftCopy.search.moreFailed}</Text>
                <SecondaryButton size="sm" icon="refresh" onPress={favorites.loadMore}>
                  {draftCopy.search.moreRetry}
                </SecondaryButton>
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  skeletons: { padding: spacing[5], gap: spacing[8] },
  skelCard: { gap: spacing[2] },
  skelImage: { aspectRatio: 16 / 9, borderRadius: 16, backgroundColor: colors.foodPlaceholder, marginBottom: spacing[1] },
  footerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footerText: { ...text.body2, color: colors.inkTertiary },
});
