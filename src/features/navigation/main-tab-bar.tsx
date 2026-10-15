import type { BottomTabBarProps } from 'expo-router/tabs';

import { BottomNavigation, type BottomNavigationItem } from '@/components/ui/bottom-navigation';
import { selectHasUnread, useHistoryStore } from '@/features/history/history-store';

/** 하단 탭 5개. id는 `src/app/(tabs)/`의 라우트 이름과 같다 */
const TABS = [
  { id: 'index', label: '홈', icon: 'home' },
  { id: 'search', label: '검색', icon: 'search' },
  { id: 'favorites', label: '찜', icon: 'heart' },
  { id: 'history', label: '내역', icon: 'receipt' },
  { id: 'my', label: '마이', icon: 'user' },
] as const satisfies readonly BottomNavigationItem[];

type TabId = (typeof TABS)[number]['id'];

/** Expo Router 탭 상태를 BottomNavigation에 연결한다. 내역 탭의 점은 모든 본인 주문의 읽지 않은 업데이트 기준이다 (FR-NAV-003) */
export function MainTabBar({ state, navigation }: BottomTabBarProps) {
  const hasUnreadOrderUpdate = useHistoryStore(selectHasUnread);
  const items = TABS.map((tab) => (tab.id === 'history' ? { ...tab, badge: hasUnreadOrderUpdate } : tab));

  const handleChange = (id: TabId) => {
    const route = state.routes.find((r) => r.name === id);
    if (!route) return;
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (state.routes[state.index]?.key !== route.key && !event.defaultPrevented) {
      navigation.navigate(route.name, route.params);
    }
  };

  return <BottomNavigation items={items} active={state.routes[state.index]?.name as TabId} onChange={handleChange} />;
}
