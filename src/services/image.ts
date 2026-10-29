import { dataSource, supabaseConfig } from '@/config/data-source';

/** 공개 Storage 버킷 이름. 읽기만 공개이고 업로드는 서버 관리자만 한다 (혜지 님 정함) */
const MENU_IMAGE_BUCKET = 'menu-images';

/** 서버가 image_ref에 넣는 경로: menus/<메뉴 UUID>.<확장자>. 이 모양이 아니면 그리지 않는다 */
const MENU_IMAGE_PATH = /^menus\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpe?g)$/i;

/**
 * imageRef(서버가 내려주는 이미지 경로)를 화면에 그릴 수 있는 URL로 바꾼다.
 *
 * supabase 모드이고 imageRef가 `menus/<UUID>.<확장자>` 모양일 때만 공개 Storage 주소를 돌려준다.
 * 그 밖에는 null이다: 사진이 없는 메뉴(NULL), Mock 데이터의 예시 경로, 알 수 없는 모양.
 * null이면 FoodImage가 중립 Placeholder를 그린다 (FR-STORE-003).
 * 디자인 캔버스의 예시 일러스트는 출시 화면에 쓰지 않는다.
 */
export function resolveImageUrl(imageRef: string | null): string | null {
  if (dataSource !== 'supabase' || !imageRef || !MENU_IMAGE_PATH.test(imageRef)) return null;
  const config = supabaseConfig();
  if (!config) return null;
  return `${config.url.replace(/\/+$/, '')}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${imageRef}`;
}
