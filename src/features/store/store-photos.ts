import type { StoreDetailDto } from '@/contracts/catalog';
import { resolveImageUrl } from '@/services/image';

/**
 * 가게 상세 갤러리에 보여 줄 사진 URL 목록(보여 줄 순서대로, 첫 장 = 대표사진).
 *
 * - 서버가 준 photos가 있으면 그 순서를 그대로 쓴다. 그릴 수 없는 경로(알 수 없는 모양·Mock)는 건너뛰고, 같은 사진이 두 번 오면 한 번만 쓴다.
 * - photos가 없거나(구버전 응답) 비었거나 그릴 수 있는 사진이 하나도 없으면 기존 대표사진 imageRef 한 장으로 보여 준다.
 * - 대표사진도 없으면 [null] 한 장: FoodImage가 중립 Placeholder를 그린다(넘김·장수 표시 없음).
 */
export function storePhotoUris(store: Pick<StoreDetailDto, 'imageRef' | 'photos'>): (string | null)[] {
  const seen = new Set<string>();
  const uris: string[] = [];
  for (const p of store.photos ?? []) {
    const uri = resolveImageUrl(p.imageRef);
    if (uri && !seen.has(uri)) {
      seen.add(uri);
      uris.push(uri);
    }
  }
  if (uris.length > 0) return uris;
  return [resolveImageUrl(store.imageRef)];
}

/** 가로로 밀어 멈춘 위치(offsetX)에서 현재 장 번호(0부터). 범위를 벗어나면 끝 장으로 맞춘다 */
export function pageIndexFromOffset(offsetX: number, pageWidth: number, count: number): number {
  if (!(pageWidth > 0) || count <= 0) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(offsetX / pageWidth)));
}

/** 오른쪽 아래 장수 표시. 한 장이면 표시하지 않는다(null) */
export function photoCounterLabel(index: number, count: number): string | null {
  return count >= 2 ? `${index + 1}/${count}` : null;
}
