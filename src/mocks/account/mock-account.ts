import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { useMockSession } from '@/mocks/session/mock-session';
import type { AccountService, MockBank, MockDestinationAccount } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';

/** 은행 목록 예시. 실제 bank_code 매핑은 명세 destination_accounts를 따른다 */
const BANKS: MockBank[] = [
  { bankCode: 'TOSS', bankName: '토스뱅크' },
  { bankCode: 'KAKAO', bankName: '카카오뱅크' },
  { bankCode: 'KB', bankName: 'KB국민은행' },
  { bankCode: 'SHINHAN', bankName: '신한은행' },
  { bankCode: 'WOORI', bankName: '우리은행' },
  { bankCode: 'HANA', bankName: '하나은행' },
  { bankCode: 'NH', bankName: 'NH농협은행' },
  { bankCode: 'IBK', bankName: 'IBK기업은행' },
];

export function createMockAccountService(): AccountService {
  return {
    listBanks: () => BANKS,

    async registerDestinationAccount({ bankCode, bankName, accountNumber, mode }) {
      await mockDelay();
      if (mockScenario.accountSave === 'failOnce' && failOnce('account:save')) throw new ServiceError('NETWORK_UNAVAILABLE');
      const current = useMockSession.getState().destinationAccount;
      const account: MockDestinationAccount = {
        id: current?.id ?? 'mock-account-1',
        revision: mode === 'change' && current ? current.revision + 1 : 1,
        bankCode,
        bankName,
        // 입력한 번호에서 끝 4자리만 쓰고 나머지는 어디에도 남기지 않는다
        last4: accountNumber.slice(-4),
      };
      useMockSession.setState({ destinationAccount: account });
      return account;
    },

    async deleteDestinationAccount(accountId) {
      await mockDelay();
      const current = useMockSession.getState().destinationAccount;
      if (current?.id === accountId) useMockSession.setState({ destinationAccount: null });
    },
  };
}
