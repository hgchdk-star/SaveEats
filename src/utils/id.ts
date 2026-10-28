/**
 * 기기 안에서만 쓰는 식별자(장바구니 세대, 장바구니 항목)를 만든다.
 * 보안 용도가 아니므로 Math.random 기반 UUID v4 모양이면 충분하다.
 */
export function createLocalId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return (c === 'x' ? r : (r % 4) + 8).toString(16);
  });
}
