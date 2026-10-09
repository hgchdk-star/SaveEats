/**
 * 리뷰 본문 글자 수: 앞뒤의 공백(U+0020)을 뺀 Unicode 글자 수 (REV-003).
 * JS의 length(UTF-16)를 그대로 쓰지 않는다. 이모지 하나가 2로 세어지기 때문이다.
 * 클라이언트와 서버가 같은 규칙으로 세야 하므로, 클라이언트만 다르게 trim하지 않는다.
 */
export function reviewBodyLength(body: string): number {
  return Array.from(body.replace(/^ +| +$/g, '')).length;
}
