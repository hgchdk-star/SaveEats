/**
 * imageRef(서버가 내려주는 이미지 키)를 화면에 그릴 수 있는 URL로 바꾼다.
 *
 * 아직 이미지 저장소와 주소 규칙이 정해지지 않아 항상 null을 돌려준다.
 * null이면 FoodImage가 중립 Placeholder를 그린다 (FR-STORE-003).
 * 디자인 캔버스의 예시 일러스트는 출시 화면에 쓰지 않는다.
 */
export function resolveImageUrl(imageRef: string | null): string | null {
  void imageRef;
  return null;
}
