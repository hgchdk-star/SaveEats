import type { AccountVault } from '@/infrastructure/local/account-vault';
import { ServiceError } from '@/services/service-error';
import { getSession } from '@/services/session';

import { loadOrderDestinationLink } from './order-destination-link';

/**
 * 직접 이어가기·사전입력에서 계좌번호 원문을 꺼낸다 (TRF-002 · 007).
 *
 * 원문은 이 기기의 AccountVault에서만 읽는다. 서버에서 받지 않는다.
 * 주문을 만들 때 기기에 남긴 목적지 참조(destinationRef · revision)가 AccountVault의 현재 계좌와 같을 때만 돌려준다.
 * 연결이 없거나 계좌가 바뀌었거나 읽지 못하면 DESTINATION_UNAVAILABLE을 던진다. 호출하는 쪽은 복사·사전입력을 막고
 * 목적지 확인 안내를 보여주며, 마스킹 번호로 대신하거나 현재 계좌를 과거 주문에 대신 쓰지 않는다.
 * TODO(OPEN-DB-002): 계좌를 바꾼 뒤의 과거 PENDING 주문에서 원문을 어떻게 보관·제공할지는 미결정이다. 그때까지는 이 연결 확인으로 막는다.
 */
export function createDestinationResolver(vault: AccountVault) {
  return async function resolveDestinationAccountNumber(orderId: string): Promise<string> {
    const uid = getSession().userId;
    if (!uid) throw new ServiceError('AUTH_REQUIRED');
    try {
      const link = await loadOrderDestinationLink(orderId);
      const current = await vault.getCurrent(uid);
      if (!link || !current || current.destinationRef !== link.destinationRef || current.revision !== link.revision) {
        throw new ServiceError('DESTINATION_UNAVAILABLE');
      }
      const raw = await vault.readCurrentAccountNumber(uid);
      if (!raw) throw new ServiceError('DESTINATION_UNAVAILABLE');
      return raw;
    } catch (error) {
      // 저장소 오류에 계좌 값이 담기지 않지만, 화면에는 어떤 내용도 넘기지 않는다
      throw error instanceof ServiceError ? error : new ServiceError('DESTINATION_UNAVAILABLE');
    }
  };
}
