import type { BottomTabBarProps } from 'expo-router/tabs';

import { BottomNavigation, type BottomNavigationItem } from '@/components/ui/bottom-navigation';

/** 하단 탭 5개. id는 `src/app/(tabs)/`의 라우트 이름과 같다 */
const TABS = [
  { id: 'index', label: '홈', icon: 'home' },
  { id: 'search', label: '검색', icon: 'search' },
  { id: 'favorites', label: '찜', icon: 'heart' },
  { id: 'history', label: '내역', icon: 'receipt' },
  { id: 'my', label: '마이', icon: 'user' },
] as const satisfies readonly BottomNavigationItem[];

type TabId = (typeof TABS)[number]['id'];

type MainTabBarProps = BottomTabBarProps & {
  /** 확인하지 않은 주문 상태 업데이트가 하나 이상 있는지. 내역 탭에 알림 점을 찍는다 (FR-NAV-003) */
  hasUnreadOrderUpdate?: boolean;
};

/**
 * Expo Router 탭 상태를 BottomNavigation에 연결한다.
 * SDK 58부터 탭 바는 `navigation` 대신 `emitter`와 `navigateToTab(route.key)`를 받는다 (기본 탭 바와 같은 순서).
 */
export function MainTabBar({ state, emitter, navigateToTab, hasUnreadOrderUpdate = false }: MainTabBarProps) {
  const items = TABS.map((tab) => (tab.id === 'history' ? { ...tab, badge: hasUnreadOrderUpdate } : tab));

  const handleChange = (id: TabId) => {
    const route = state.routes.find((r) => r.name === id);
    if (!route) return;
    const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (state.routes[state.index]?.key !== route.key && !event.defaultPrevented) {
      navigateToTab(route.key);
    }
  };

  return <BottomNavigation items={items} active={state.routes[state.index]?.name as TabId} onChange={handleChange} />;
}
