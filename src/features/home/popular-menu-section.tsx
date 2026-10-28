import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SectionError, Skeleton } from '@/components/ui/feedback-states';
import { FoodImage } from '@/components/ui/food-image';
import { Price } from '@/components/ui/price';
import { draftCopy } from '@/config/draft-copy';
import type { MenuCardDto } from '@/contracts/catalog';
import type { AsyncState } from '@/hooks/use-async';
import { resolveImageUrl } from '@/services/image';
import { colors, radius, spacing, text } from '@/theme';

import { SectionHeader } from './section-header';

type Props = { state: AsyncState<MenuCardDto[]> & { reload: () => void } };

const TILE = 128;

/**
 * 홈 "지금 많이 찾는 메뉴" (기획서 11.1). Seed 인기 값으로 만들고, 점수·순위 숫자·주문 수는 보여주지 않는다 (FR-HOME-005).
 * 메뉴가 0개이면 섹션을 숨기고, 불러오지 못했을 때는 이 섹션만 오류와 다시 시도를 보여준다.
 * 서버가 품절 메뉴를 빼서 주므로 화면에서 따로 거르지 않는다.
 */
export function PopularMenuSection({ state }: Props) {
  const router = useRouter();

  if (state.status === 'ok' && state.data.length === 0) return null;

  return (
    <View style={styles.section}>
      <SectionHeader title={draftCopy.home.popularTitle} />
      {state.status === 'loading' ? (
        <View accessibilityLabel="불러오는 중" style={styles.row}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={styles.tile}>
              <View style={styles.skelImage} />
              <Skeleton width="80%" height={14} />
            </View>
          ))}
        </View>
      ) : null}
      {state.status === 'error' ? <SectionError message={draftCopy.home.sectionError} onRetry={state.reload} /> : null}
      {state.status === 'ok' ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {state.data.map((menu) => (
            <Pressable
              key={menu.id}
              accessibilityRole="button"
              accessibilityLabel={`${menu.name}, ${menu.store.name}`}
              onPress={() => router.push({ pathname: '/menu/[menuId]', params: { menuId: menu.id } })}
              style={styles.tile}>
              <FoodImage uri={resolveImageUrl(menu.imageRef)} ratio="1:1" width={TILE} rounded={radius.md} />
              <Text numberOfLines={2} style={styles.name}>
                {menu.name}
              </Text>
              <Text numberOfLines={1} style={styles.store}>
                {menu.store.name}
              </Text>
              <Price amount={menu.price} size="sm" />
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing[8] },
  row: { paddingHorizontal: spacing[5], gap: spacing[3], alignItems: 'flex-start' },
  tile: { width: TILE, gap: 2 },
  skelImage: { width: TILE, height: TILE, borderRadius: radius.md, backgroundColor: colors.foodPlaceholder, marginBottom: spacing[1] },
  name: { ...text.label, color: colors.ink, marginTop: spacing[1] },
  store: { ...text.caption, color: colors.inkTertiary },
});
