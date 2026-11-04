import { router } from 'expo-router';

import { draftCopy } from '@/config/draft-copy';
import { useFavoritesStore } from '@/features/favorites/favorites-store';
import { useHistoryStore } from '@/features/history/history-store';
import { useOrderFlowStore } from '@/features/order/order-flow-store';
import { recoverOnStart } from '@/features/order/recovery';
import { useReviewStore } from '@/features/review/review-store';
import { showToast } from '@/features/toast/toast-store';
import { LIMITS } from '@/config/limits';
import { accountVault, authService, loadDeviceAccountIntoSession } from '@/services';
import { getSession } from '@/services/session';

import { useLoginIntentStore } from './login-intent-store';
import { loadProfileSetupPending } from './profile-setup-pending';

/**
 * 로그인·로그아웃에 따른 개인 데이터 정리 (AUTH-004).
 *
 * 화면 메모리에 있는 개인 데이터(내역 · 읽지 않음 · 내 리뷰 표시 · 찜 표시 · 진행 중인 주문 화면 상태)를 지운다.
 * 기기에 저장된 개인 기록(완료 확인 큐 · 주문 생성 시도 · 읽음 대기)은 지우지 않고 사용자별 키로 격리해 둔다:
 * 로그아웃은 토큰 정리일 뿐 주문 취소 · 기록 삭제가 아니고, 완료 확인 의도가 사라지면 안 되기 때문이다.
 * 다른 계정으로 로그인하면 키가 달라 이전 계정의 기록을 읽지도 처리하지도 않는다. 원래 계정으로 다시 로그인할 때만 복구한다.
 * Guest 장바구니 영역은 지우지 않고, 사용자 장바구니를 복제하지도 않는다 (서버 장바구니 계약 전까지 기기 장바구니는 하나뿐이다).
 * 최근 검색어 · 최근 본 항목은 이 기기에만 있고 계정과 분리돼 있어 건드리지 않는다.
 */
export function clearPersonalData(): void {
  useHistoryStore.getState().reset();
  useReviewStore.getState().reset();
  useFavoritesStore.getState().reset();
  useOrderFlowStore.getState().reset();
  useLoginIntentStore.getState().setIntent(null);
}

/** 로그아웃: 확인 시트 없이 바로 한다 (미결정 묶음4 #3). 토큰 정리에 실패해도 이 기기의 세션은 닫는다 */
export async function logout(): Promise<void> {
  const uid = getSession().userId;
  try {
    await authService.signOut();
  } catch {
    // 서버 쪽 정리가 실패해도 기기 화면에서는 로그아웃 처리한다. 이미 발급된 토큰의 서버 유효기간과는 별개다
  }
  // 로그아웃하면 이 사용자의 계좌 원문을 기기 보안 저장소에서 지운다. 지우지 못했다면 지운 것처럼 알리지 않는다
  let accountCleared = true;
  if (uid) {
    try {
      await accountVault.delete(uid);
    } catch {
      accountCleared = false;
    }
  }
  clearPersonalData();
  router.dismissAll();
  router.navigate('/');
  showToast(accountCleared ? { message: draftCopy.settings.toastLoggedOut } : { message: draftCopy.settings.toastLoggedOutAccountKept, tone: 'error' });
}

/**
 * 앱을 켤 때 한 번: 저장된 로그인 세션을 복원하고, 사용자가 로그아웃하지 않았는데 세션을 잃으면 개인 데이터를 정리한다 (AUTH-002).
 * 복원이 느리면(네트워크 갱신 등) LIMITS.authRestoreTimeoutMs까지만 기다리고 먼저 Guest로 연다. 늦게 복원되면 그때 로그인 상태가 되고
 * 기기 기록 복구와 계좌 불러오기를 이어서 한다. 세션이 없는 Guest는 서버를 부르지 않는다.
 */
let authStarted = false;
export async function startAuth(): Promise<void> {
  if (authStarted) return;
  authStarted = true;
  authService.onForcedSignOut(() => {
    clearPersonalData();
    showToast({ message: draftCopy.login.sessionExpired });
  });

  let timedOut = false;
  const restored = authService.restore();
  await Promise.race([
    restored,
    new Promise<void>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, LIMITS.authRestoreTimeoutMs),
    ),
  ]);
  // 먼저 열었다가 늦게 복원된 경우: 로그인 직후와 같은 후속 처리를 한다
  if (timedOut) void restored.then(() => (getSession().isMember ? afterLogin() : undefined));
  else if (getSession().isMember) void loadDeviceAccountIntoSession();
  // 가입만 되고 닉네임 저장이 끝나지 않은 계정이면 같은 계정으로 프로필 설정을 이어간다 (로그인 화면을 거치지 않는 경로)
  void restored.then(() => openProfileSetupIfPending());
}

/** 앱을 다시 열었을 때: 닉네임 저장이 끝나지 않은 계정이면 프로필 설정 화면을 연다. 기존 계정의 닉네임 없음은 여기서 막지 않는다 */
async function openProfileSetupIfPending(): Promise<void> {
  if (!getSession().isMember || !(await loadProfileSetupPending())) return;
  try {
    router.push({ pathname: '/profile-setup', params: { mode: 'recover' } });
  } catch {
    // 화면을 열지 못하면 설정의 "설정하기"로 같은 화면에 들어올 수 있다
  }
}

/**
 * 로그인에 성공한 직후: 이 사용자의 기기 기록(완료 확인 큐 · 읽음 대기)을 복구한다.
 * 이전 사용자의 화면 데이터는 로그아웃 때 이미 비웠으므로 여기서 다시 지우지 않는다(로그인 전에 받은 리뷰로 도움돼요를 이어가야 한다).
 */
export function afterLogin(): void {
  void recoverOnStart();
  // 이 기기에 저장된 이 사용자의 계좌를 세션에 올린다 (계좌는 서버에 없다)
  void loadDeviceAccountIntoSession();
}
