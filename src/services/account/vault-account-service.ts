import type { AccountVault, VaultAccountView } from '@/infrastructure/local/account-vault';
import { failOnce, mockScenario } from '@/mocks/scenario';
import type { AccountService, MockDestinationAccount } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';
import { getSession, setSessionDestinationAccount } from '@/services/session';

import { BANKS } from './banks';

/**
 * 계좌 서비스. 계좌는 서버가 아니라 이 기기의 AccountVault(보안 저장소)에만 있다. EXPO_PUBLIC_DATA_SOURCE와 상관없이 같다.
 *
 * - 저장·삭제가 실패하면 ServiceError('ACCOUNT_STORAGE_FAILED')를 던진다. 삭제 실패를 삭제 완료로 보여주지 않는다.
 * - 로그인한 사용자(uid)의 자료만 다룬다. 로그인 전이면 ServiceError('AUTH_REQUIRED').
 * - 저장소 응답이 늦게 도착했을 때 그 사이 다른 사용자로 바뀌었다면 현재 세션에는 반영하지 않는다.
 */

const toAccount = (v: VaultAccountView): MockDestinationAccount => ({
  id: v.destinationRef,
  revision: v.revision,
  bankCode: v.bankCode,
  bankName: v.bankName,
  last4: v.last4,
});

function requireUid(): string {
  const uid = getSession().userId;
  if (!uid) throw new ServiceError('AUTH_REQUIRED');
  return uid;
}

async function guard<T>(op: () => Promise<T>): Promise<T> {
  try {
    return await op();
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    // 원래 오류에는 계좌 값이 없지만, 화면에는 어떤 내용도 넘기지 않는다
    throw new ServiceError('ACCOUNT_STORAGE_FAILED');
  }
}

export function createVaultAccountService(vault: AccountVault): AccountService {
  return {
    listBanks: () => BANKS,

    async registerDestinationAccount({ bankCode, bankName, accountNumber }) {
      const uid = requireUid();
      // 개발용 시나리오: 저장이 한 번 실패한다
      if (mockScenario.accountSave === 'failOnce' && failOnce('account:save')) throw new ServiceError('ACCOUNT_STORAGE_FAILED');
      // 등록과 변경 모두 같은 저장이다. 이미 있으면 새 참조·revision+1, 없으면 처음 등록
      const saved = await guard(() => vault.replace(uid, { bankCode, bankName, accountNumber }));
      const account = toAccount(saved);
      if (getSession().userId === uid) setSessionDestinationAccount(account);
      return account;
    },

    async deleteDestinationAccount(accountId) {
      const uid = requireUid();
      await guard(() => vault.delete(uid));
      const { userId, destinationAccount } = getSession();
      if (userId === uid && destinationAccount?.id === accountId) setSessionDestinationAccount(null);
    },
  };
}

/**
 * 로그인 직후, 이 기기에 저장된 이 사용자의 계좌를 세션에 올린다.
 * 읽지 못하면 세션의 값을 그대로 둔다("계좌 없음"으로 덮어쓰지 않는다). 저장소는 건드리지 않는다.
 */
export async function loadAccountFromVault(vault: AccountVault): Promise<void> {
  const uid = getSession().userId;
  if (!uid) return;
  try {
    const saved = await vault.getCurrent(uid);
    if (saved && getSession().userId === uid) setSessionDestinationAccount(toAccount(saved));
  } catch {
    // 읽기 실패는 조용히 둔다. 사용자가 계좌 화면에서 다시 등록하면 덮어쓴다
  }
}
