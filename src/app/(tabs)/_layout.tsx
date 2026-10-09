import { Tabs } from 'expo-router';

import { MainTabBar } from '@/features/navigation/main-tab-bar';

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <MainTabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="search" />
      <Tabs.Screen name="favorites" />
      <Tabs.Screen name="history" />
      <Tabs.Screen name="my" />
    </Tabs>
  );
}
