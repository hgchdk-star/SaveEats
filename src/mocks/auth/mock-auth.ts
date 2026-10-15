import { failOnce, mockDelay, mockScenario } from '@/mocks/scenario';
import { PRESET_ACCOUNT, useMockSession } from '@/mocks/session/mock-session';
import type { AuthService, SignInInput } from '@/mocks/order/types';
import { ServiceError } from '@/services/service-error';

/**
 * 로그인 Mock. 어떤 이메일·비밀번호든 성공한다 (시나리오가 실패를 정하지 않는 한).
 * 비밀번호는 어디에도 저장하지 않는다.
 */
async function authenticate(input: SignInInput, kind: string): Promise<{ userId: string }> {
  void input;
  await mockDelay();
  if (mockScenario.login === 'invalidOnce' && failOnce(`${kind}:invalid`)) throw new ServiceError('INVALID_CREDENTIALS');
  if (mockScenario.login === 'networkOnce' && failOnce(`${kind}:network`)) throw new ServiceError('NETWORK_UNAVAILABLE');
  useMockSession.setState({
    isMember: true,
    destinationAccount: mockScenario.accountOnLogin ? PRESET_ACCOUNT : useMockSession.getState().destinationAccount,
  });
  return { userId: 'mock-user-1' };
}

export function createMockAuthService(): AuthService {
  return {
    signIn: (input) => authenticate(input, 'signIn'),
    signUp: (input) => authenticate(input, 'signUp'),
    async signOut() {
      await mockDelay();
      useMockSession.setState({ isMember: false, destinationAccount: null });
    },
  };
}
