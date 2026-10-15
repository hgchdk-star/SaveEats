import { useRouter } from 'expo-router';

import { StoreCard } from '@/components/ui/store-card';
import type { StoreCardDto } from '@/contracts/catalog';
import { draftCopy } from '@/config/draft-copy';
import { useFavorite } from '@/features/favorites/favorites-store';
import { showToast } from '@/features/toast/toast-store';
import { resolveImageUrl } from '@/services/image';

type StoreCardItemProps = {
  store: StoreCardDto;
  wrapNames?: boolean;
  /**
   * 검색 결과에서 메뉴 이름으로 걸린 메뉴. 있으면 대표 메뉴 대신 이 메뉴의 이름·가격을 보여준다 (FR-SRCH-005).
   * 가게 이름·카테고리로만 걸렸으면 넘기지 않고 대표 메뉴를 보여준다.
   */
  matchingMenu?: { name: string; price: number } | null;
  /** 카드를 열기 직전에 할 일 (검색 결과: 검색어를 최근 검색어로 저장) */
  beforeOpen?: () => void;
  /** 찜 목록 안의 카드: 해제하면 목록에서 빠지고 '되돌리기' 토스트를 띄운다 */
  fromFavoritesList?: boolean;
};

/**
 * 계약의 StoreCardDto를 StoreCard 모양에 맞춰 그린다.
 * 홈 추천 · 검색 · 카테고리 · 찜이 같은 값으로 카드를 그리도록 한 곳에 둔다.
 * 찜 상태는 모두 favorites-store의 같은 값을 읽는다(favoriteStoreIds).
 */
export function StoreCardItem({ store, wrapNames = false, matchingMenu, beforeOpen, fromFavoritesList = false }: StoreCardItemProps) {
  const router = useRouter();
  const favorite = useFavorite(store.id, store.isFavorite);
  const { reviewSummary: review, representativeMenu: representative } = store;
  const menu = matchingMenu ?? representative;

  const toggle = (next: boolean) => {
    favorite.toggle(next);
    if (fromFavoritesList && !next) {
      showToast({ message: draftCopy.favorites.removed, action: { label: draftCopy.favorites.undo, onPress: () => favorite.toggle(true) } });
    }
  };

  return (
    <StoreCard
      name={store.name}
      imageUri={resolveImageUrl(store.imageRef)}
      category={store.category.name}
      menu={menu ? { name: menu.name, price: menu.price } : null}
      rating={review.averageCravingRating}
      reviewCount={review.count}
      favorite={favorite.value}
      isOpen={store.isOpen}
      closedLabel={draftCopy.store.statusClosed}
      wrapNames={wrapNames}
      onPress={() => {
        beforeOpen?.();
        router.push({ pathname: '/store/[storeId]', params: { storeId: store.id } });
      }}
      onToggleFavorite={toggle}
    />
  );
}
