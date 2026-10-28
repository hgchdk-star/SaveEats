import { Stack } from 'expo-router';

// 검색 탭 안의 스택: index = 검색 전(㉑), results = 검색 결과(㉒). 하단 탭은 결과 화면에서도 그대로 보인다.
// 결과 화면을 바로 열어도 뒤로가기가 검색 전 화면으로 가도록 index를 맨 아래에 둔다.
export const unstable_settings = { initialRouteName: 'index' };

export default function SearchLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
