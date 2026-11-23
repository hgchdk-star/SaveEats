import type { StoreDetailDto } from '@/contracts/catalog';

/**
 * 개발 전용 미리보기: 서버에 사진을 올리기 전에, 내 컴퓨터의 미리보기 서버(data/imports/store-photos-20261123/preview_server.py)가 주는
 * 수집 사진으로 가게 목록·상세 갤러리를 앱에서 미리 본다. 출시 빌드(`__DEV__`가 false)에서는 항상 꺼져 있고, 환경변수가 없어도 꺼져 있다.
 *
 * EXPO_PUBLIC_STORE_PHOTO_PREVIEW_URL = http://<내 컴퓨터 IP>:8099  (공개해도 되는 로컬 주소만. 비밀값 아님)
 *  - 목록·상세의 가게 사진 경로(stores/...)를 미리보기 서버 주소로 바꾼다. 미리보기 대상이 아닌 가게는 서버가 원래 Storage 주소로 돌려보낸다.
 *  - 가게 상세 응답에 photos가 없으면(서버 migration 전) 미리보기 서버의 사진 목록을 채워 준다.
 */
export function storePhotoPreviewBase(): string | null {
  const dev = typeof __DEV__ !== 'undefined' && __DEV__;
  const base = process.env.EXPO_PUBLIC_STORE_PHOTO_PREVIEW_URL;
  return dev && base ? base.replace(/\/+$/, '') : null;
}

const STORE_REF = /^stores\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(-[0-9a-f]{8})?\.(?:png|jpe?g)$/i;

/** 미리보기가 켜져 있고 가게 사진 경로이면 미리보기 서버 URL, 아니면 null(원래 주소를 쓴다) */
export function previewImageUrl(imageRef: string, realUrl: string): string | null {
  const base = storePhotoPreviewBase();
  const m = base ? STORE_REF.exec(imageRef) : null;
  if (!base || !m) return null;
  return m[2] ? `${base}/img/${imageRef}?fallback=${encodeURIComponent(realUrl)}` : `${base}/rep/${m[1]}?fallback=${encodeURIComponent(realUrl)}`;
}

/** 상세 응답에 갤러리 사진이 없으면 미리보기 서버의 목록으로 채운다. 실패하면 응답을 그대로 돌려준다 */
export async function withPreviewPhotos(store: StoreDetailDto): Promise<StoreDetailDto> {
  const base = storePhotoPreviewBase();
  if (!base || (store.photos && store.photos.length > 0)) return store;
  try {
    const res = await fetch(`${base}/preview/stores/${store.id}.json`);
    if (!res.ok) return store;
    const data = (await res.json()) as { imageRef?: string; photos?: { imageRef: string }[] };
    if (!Array.isArray(data.photos) || data.photos.length === 0) return store;
    return { ...store, imageRef: data.imageRef ?? store.imageRef, photos: data.photos };
  } catch {
    return store;
  }
}
