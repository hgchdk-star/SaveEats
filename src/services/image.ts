import { dataSource, supabaseConfig } from '@/config/data-source';

import { previewImageUrl } from './store-photo-preview';

/** 공개 Storage 버킷 이름. 읽기만 공개이고 업로드는 서버 관리자만 한다 (혜지 님 정함) */
const MENU_IMAGE_BUCKET = 'menu-images';

/**
 * 서버가 image_ref에 넣는 경로.
 *  - menus/<메뉴 UUID>.<확장자>
 *  - menus/<메뉴 UUID>-<8자리 16진 해시>.<확장자>  (수집 사진으로 교체한 메뉴: 기존 파일을 지우지 않고 별도 경로로 올린 것)
 *  - stores/<가게 UUID>.<확장자>
 *  - stores/<가게 UUID>-<8자리 16진 해시>.<확장자>  (가게 대표·갤러리 사진: 파일마다 별도 경로, 기존 대표사진 파일은 지우지 않는다)
 * 이 모양이 아니면 그리지 않는다(경로 이동·다른 버킷·그 밖의 접미사 거부).
 */
const MENU_IMAGE_PATH = /^(?:menus|stores)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[0-9a-f]{8})?\.(?:png|jpe?g)$/i;

/**
 * imageRef(서버가 내려주는 이미지 경로)를 화면에 그릴 수 있는 URL로 바꾼다.
 *
 * supabase 모드이고 imageRef가 위 모양(`menus|stores/<UUID>[-<8자리 해시>].<확장자>`)일 때만 공개 Storage 주소를 돌려준다.
 * 그 밖에는 null이다: 사진이 없는 메뉴(NULL), Mock 데이터의 예시 경로, 알 수 없는 모양.
 * null이면 FoodImage가 중립 Placeholder를 그린다 (FR-STORE-003).
 * 디자인 캔버스의 예시 일러스트는 출시 화면에 쓰지 않는다.
 */
export function resolveImageUrl(imageRef: string | null): string | null {
  if (dataSource !== 'supabase' || !imageRef || !MENU_IMAGE_PATH.test(imageRef)) return null;
  const config = supabaseConfig();
  if (!config) return null;
  const real = `${config.url.replace(/\/+$/, '')}/storage/v1/object/public/${MENU_IMAGE_BUCKET}/${imageRef}`;
  return previewImageUrl(imageRef, real) ?? real;   // 개발 전용 미리보기가 꺼져 있으면 항상 real
}
