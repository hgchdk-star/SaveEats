import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FoodImage } from '@/components/ui/food-image';
import { SectionError } from '@/components/ui/feedback-states';
import { draftCopy } from '@/config/draft-copy';
import { useAsync } from '@/hooks/use-async';
import { mockHome } from '@/mocks/home/mock-home';
import { resolveImageUrl } from '@/services/image';
import { colors, font, radius, spacing, text } from '@/theme';

import { useRecentViewedStore, type RecentViewedItem } from './recent-viewed-store';
import { SectionHeader } from './section-header';

type Tile = { key: string; item: RecentViewedItem; kind: string; name: string; imageRef: string | null };

/**
 * 최근 본 가게·메뉴 (FR-HOME-008~011). 기록이 없으면 섹션 전체를 숨긴다.
 * 서버가 더 이상 내려주지 않는(비활성·삭제된) 항목은 목록에서 지운다.
 * 조회에 실패했을 때는 지우지 않는다. 실패는 "없음"이 아니다.
 */
export function RecentSection() {
  const router = useRouter();
  const items = useRecentViewedStore((s) => s.items);
  const drop = useRecentViewedStore((s) => s.drop);

  const storeIds = items.filter((it) => it.type === 'STORE').map((it) => it.id);
  const menuIds = items.filter((it) => it.type === 'MENU').map((it) => it.id);
  const key = items.map((it) => `${it.type}:${it.id}`).join(',');

  const state = useAsync(`recent:${key}`, async () => {
    if (items.length === 0) return { tiles: [] as Tile[], gone: [] as RecentViewedItem[] };
    const [stores, menus] = await Promise.all([
      storeIds.length ? mockHome.listStoresByIds(storeIds) : Promise.resolve([]),
      menuIds.length ? mockHome.listMenusByIds(menuIds) : Promise.resolve([]),
    ]);
    const tiles: Tile[] = [];
    const gone: RecentViewedItem[] = [];
    for (const item of items) {
      if (item.type === 'STORE') {
        const s = stores.find((x) => x.id === item.id);
        if (s) tiles.push({ key: `S${item.id}`, item, kind: draftCopy.home.recentKindStore, name: s.name, imageRef: s.imageRef });
        else gone.push(item);
      } else {
        const m = menus.find((x) => x.id === item.id);
        if (m) tiles.push({ key: `M${item.id}`, item, kind: draftCopy.home.recentKindMenu, name: m.name, imageRef: m.imageRef });
        else gone.push(item);
      }
    }
    return { tiles, gone };
  });

  useEffect(() => {
    if (state.status === 'ok') drop(state.data.gone);
  }, [state.status, state.data, drop]);

  if (items.length === 0) return null;

  const open = (item: RecentViewedItem) =>
    item.type === 'STORE'
      ? router.push({ pathname: '/store/[storeId]', params: { storeId: item.id } })
      : router.push({ pathname: '/menu/[menuId]', params: { menuId: item.id } });

  return (
    <View style={styles.section}>
      <SectionHeader title={draftCopy.home.recentTitle} />
      {state.status === 'error' ? <SectionError message={draftCopy.home.sectionError} onRetry={state.reload} /> : null}
      {state.status === 'ok' && state.data.tiles.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
          {state.data.tiles.map((tile) => (
            <Pressable key={tile.key} accessibilityRole="button" accessibilityLabel={`${tile.kind} ${tile.name}`} onPress={() => open(tile.item)} style={styles.tile}>
              <FoodImage uri={resolveImageUrl(tile.imageRef)} ratio="1:1" width={96} rounded={radius.sm} />
              <Text style={styles.kind}>{tile.kind}</Text>
              <Text numberOfLines={2} style={styles.name}>
                {tile.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing[8],
  },
  row: {
    paddingHorizontal: spacing[5],
    gap: spacing[3],
    alignItems: 'flex-start',
  },
  tile: {
    width: 96,
    gap: 2,
  },
  kind: {
    ...font('600'),
    fontSize: 11,
    lineHeight: 14,
    color: colors.inkTertiary,
    marginTop: spacing[1],
  },
  name: {
    ...text.label,
    fontSize: 13,
    lineHeight: 18,
    color: colors.ink,
  },
});
