import { useLocalSearchParams } from 'expo-router';

import { MenuDetailScreen } from '@/features/menu/menu-detail-screen';

export default function MenuRoute() {
  const { menuId } = useLocalSearchParams<{ menuId: string }>();
  return <MenuDetailScreen menuId={menuId} />;
}
