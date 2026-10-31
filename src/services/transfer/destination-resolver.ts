import type { AccountVault } from '@/infrastructure/local/account-vault';
import type { MockOrder } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';
import { getSession } from '@/services/session';

/**
 * 직접 이어가기에서 사용자가 '계좌번호 복사'를 눌렀을 때 원문을 꺼낸다 (TRF-002 · 007).
 *
 * 원문은 이 기기의 AccountVault에서만 읽는다. 서버에서 받지 않는다.
 * 과거 주문에 현재 계좌를 조용히 대신 쓰지 않는다: 보관된 계좌의 은행·끝 4자리가 주문 당시 목적지와 같을 때만 돌려준다.
 * 어긋나거나 읽지 못하면 던진다. 호출하는 쪽은 복사를 막고 '다시 확인'을 보여주며, 마스킹 번호로 대신하지 않는다.
 * TODO(OPEN-DB-002): 계좌를 바꾼 뒤의 과거 PENDING 주문에서 원문을 어떻게 보관·제공할지는 미결정이다. 그때까지는 이 일치 검사로 막는다.
 */
export function createDestinationResolver(vault: AccountVault, getOrder: (orderId: string) => Promise<MockOrder>) {
  return async function resolveDestinationAccountNumber(orderId: string): Promise<string> {
    const uid = getSession().userId;
    if (!uid) throw new ServiceError('AUTH_REQUIRED');
    const order = await getOrder(orderId);
    const view = await vault.getCurrent(uid);
    const dest = order.snapshot.destination;
    if (!view || view.bankName !== dest.bankName || view.last4 !== dest.last4) throw new ServiceError('DESTINATION_UNAVAILABLE');
    const raw = await vault.readCurrentAccountNumber(uid);
    if (!raw) throw new ServiceError('DESTINATION_UNAVAILABLE');
    return raw;
  };
}
