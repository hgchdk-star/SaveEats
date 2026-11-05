import { deviceSecureStore } from '@/infrastructure/local/secure-store';
import { userScopedKey } from '@/services/session';

/**
 * 주문 화면에 보여줄 "그때의 계좌" 표시값(은행명 · 끝 4자리)을 이 기기의 보안 저장소에만 둔다 (FR-ORD-013).
 * 서버는 계좌를 몰라서 주문 응답에 목적지를 주지 않는다. 앱이 목적지 참조(destinationRef)로 이 값을 찾아 합친다.
 * 계좌번호 원문은 여기에 없다(원문은 AccountVault). 은행명·끝 4자리도 로그·일반 저장소에 남기지 않는다.
 *
 * 값은 destinationRef 하나에 붙는다. 계좌를 바꾸면 새 참조가 생기므로 이전 주문은 이전 참조의 표시값을 계속 쓴다.
 * 다른 기기·재설치·보안 저장소 오류로 값이 없으면 null이고, 화면은 "이 기기에 주문 당시 계좌정보가 없어요."를 보여준다.
 * 사용자(uid)별 키라 다른 계정의 값은 읽히지 않는다.
 */
export type MaskedDestination = { bankName: string; last4: string };

const key = (ref: string) => userScopedKey(`saveeats.order.maskedDestination.v1.${ref}`).replace(/[^A-Za-z0-9._-]/g, '_');

export async function saveMaskedDestination(ref: string, value: MaskedDestination): Promise<void> {
  await deviceSecureStore.set(key(ref), JSON.stringify(value));
}

export async function loadMaskedDestination(ref: string): Promise<MaskedDestination | null> {
  try {
    const raw = await deviceSecureStore.get(key(ref));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    const v = parsed as Partial<MaskedDestination> | null;
    return v && typeof v.bankName === 'string' && typeof v.last4 === 'string' ? { bankName: v.bankName, last4: v.last4 } : null;
  } catch {
    return null;
  }
}
