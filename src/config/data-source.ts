/**
 * 데이터를 어디서 가져올지. 서버 연결을 한 번에 켜지 않고, 연결된 부분부터 하나씩 서버로 바꾸기 위한 스위치다.
 *
 * EXPO_PUBLIC_DATA_SOURCE
 *   mock     (기본) 앱 안의 가상 데이터. 서버 없이 모든 화면을 볼 수 있다
 *   supabase 서버가 연결된 부분은 Supabase에서 가져오고, 아직 연결되지 않은 부분은 계속 Mock을 쓴다
 * 값이 없거나 알 수 없는 값이면 mock이다.
 *
 * 지금 서버로 바뀌는 것: 카테고리 목록(catalogRepository.listCategories)뿐이다. 나머지는 모두 Mock이다.
 * 앱 환경변수는 `process.env.EXPO_PUBLIC_*` 점 표기법으로만 읽는다.
 */
export type DataSource = 'mock' | 'supabase';

function read(): DataSource {
  return process.env.EXPO_PUBLIC_DATA_SOURCE === 'supabase' ? 'supabase' : 'mock';
}

export const dataSource: DataSource = read();

/** 앱에 들어가도 되는 공개 설정만 읽는다. service_role·secret 키는 어디에도 두지 않는다 */
export function supabaseConfig(): { url: string; publishableKey: string } | null {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return url && publishableKey ? { url, publishableKey } : null;
}
