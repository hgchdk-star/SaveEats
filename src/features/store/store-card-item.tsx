import { useRouter } from 'expo-router';

import type { StoreCardDto } from '@/contracts/catalog';
import { StoreCard } from '@/components/ui/store-card';
import { draftCopy } from '@/config/draft-copy';
import { useFavorite } from '@/features/favorites/favorites-store';
import { resolveImageUrl } from '@/services/image';

/**
 * 계약의 StoreCardDto를 StoreCard 모양에 맞춰 그린다.
 * 홈 추천·(이후) 검색·카테고리·찜이 같은 값으로 카드를 그리도록 한 곳에 둔다.
 */
export function StoreCardItem({ store, wrapNames = false }: { store: StoreCardDto; wrapNames?: boolean }) {
  const router = useRouter();
  const favorite = useFavorite(store.id, store.isFavorite);
  const { reviewSummary: review, representativeMenu: menu } = store;

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
      onPress={() => router.push({ pathname: '/store/[storeId]', params: { storeId: store.id } })}
      onToggleFavorite={favorite.toggle}
    />
  );
}
