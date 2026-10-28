import { router } from 'expo-router';

import { LIMITS, ORDER } from '@/config/limits';
import { UNDECIDED } from '@/config/undecided';
import { draftCopy } from '@/config/draft-copy';
import { confirmedCopy } from '@/config/confirmed-copy';
import { useCartStore } from '@/features/cart/cart-store';
import { toOrder } from '@/features/history/history-model';
import { useHistoryStore } from '@/features/history/history-store';
import { showToast } from '@/features/toast/toast-store';
import type { MockHistoryRow } from '@/mocks/history/types';
import type { CreateOrderRequest, MockDestinationAccount, MockOrder } from '@/mocks/order/types';
import { orderService, transferService } from '@/services';
import { copyToClipboard } from '@/services/clipboard';
import { ServiceError, errorCode } from '@/services/service-error';
import { createLocalId } from '@/utils/id';

import type { CartEnvelope } from '@/features/cart/cart-model';

import { clearAttempt, clearConfirmQueue, loadConfirmQueue, saveAttempt, saveConfirmQueue } from './order-persistence';
import { useOrderFlowStore, type RejectedReason } from './order-flow-store';

/**
 * 주문 흐름의 동작. 화면은 이 함수만 부른다.
 *
 * 지키는 규칙
 * - 외부 앱은 PENDING 저장에 성공한 뒤, 사용자가 버튼을 눌렀을 때만 연다 (TRF-006)
 * - 결과를 모르면(CREATE_UNKNOWN) 같은 idempotencyKey로 조회·재시도만 한다. 새 주문을 만들지 않는다 (ORD-006)
 * - 완료는 사용자의 '주문 완료했어요'로만. 앱에 돌아왔다는 것, 복사에 성공했다는 것은 송금의 증거가 아니다 (TRF-001 · 008)
 * - '아직이에요'는 PENDING을 그대로 둔다. 실패도 취소도 아니다 (ORD-012)
 * 금액과 상태를 최종 판단하는 것은 서버다. 여기서는 서버가 알려준 결과를 화면 상태로 옮긴다.
 */

const flow = () => useOrderFlowStore.getState();

/** 주문이 만들어지거나 상태가 바뀐 뒤: 내역 탭의 점과 이미 열려 있는 내역 목록을 서버 기준으로 다시 맞춘다 */
function syncHistory(): void {
  const history = useHistoryStore.getState();
  void history.refreshQueue();
  void history.refreshUnread();
  if (history.load === 'ok') void history.refreshLatest();
}

/* ---------- 주문 생성 (ORD-004 · 005 · 006) ---------- */

/** 승인한 항목·가격·계좌 버전을 요청에 고정한다 */
export function buildCreateOrderRequest(cart: CartEnvelope, account: MockDestinationAccount): CreateOrderRequest {
  return {
    idempotencyKey: createLocalId(),
    requestVersion: ORDER.requestVersion,
    cartId: cart.localCartId,
    expectedCartRevision: cart.localRevision,
    storeId: cart.storeId ?? '',
    accountId: account.id,
    expectedAccountRevision: account.revision,
    items: cart.items.map((item) => ({
      menuId: item.menuId,
      optionIds: item.optionIds,
      quantity: item.quantity,
      approvedUnitPrice: item.acknowledgedUnitPrice,
      approvedCatalogRevision: item.acknowledgedCatalogRevision,
    })),
    approvedTotalAmount: cart.items.reduce((sum, item) => sum + item.acknowledgedUnitPrice * item.quantity, 0),
    disclosureVersion: ORDER.disclosureVersion,
    disclosureAcknowledged: true,
  };
}

/** 최종 주문 확인 화면에 들어올 때. 결과를 모르는 시도가 남아 있으면 건드리지 않는다 */
export function enterConfirm(): void {
  const { work } = flow();
  if (work === 'CREATE_UNKNOWN' || work === 'CREATE_SAVING') return;
  flow().reset();
}

/** 최종 주문 확인에서 나갈 때. 결과를 모르는 시도는 남긴다 (새 키를 만들지 않기 위해) */
export function leaveConfirm(): void {
  const { work } = flow();
  if (work === 'CREATE_UNKNOWN' || work === 'CREATE_SAVING') return;
  flow().reset();
}

/** '내 계좌로 주문하기' / '다른 방법으로 주문하기' */
export async function createOrder(via: 'TOSS' | 'DIRECT', cart: CartEnvelope, account: MockDestinationAccount): Promise<void> {
  const state = flow();
  if (state.work === 'CREATE_SAVING') return; // 중복 입력 잠금

  // 저장은 됐지만 전송 전에 멈춘 시도(기기 저장 실패)는 같은 요청을 다시 쓴다. 한 번도 보내지 않았으니 같은 키여도 안전하다
  const attempt = state.attempt ? { ...state.attempt, via } : { request: buildCreateOrderRequest(cart, account), via };
  flow().set({ work: 'CREATE_SAVING', attempt, rejectedReason: null });

  // 보내기 전에 키와 요청을 기기에 먼저 저장한다. 저장하지 못하면 보내지 않는다
  try {
    await saveAttempt(attempt);
  } catch {
    flow().set({ work: 'LOCAL_PERSISTENCE_FAILED' });
    return;
  }
  await send(attempt);
}

/** 결과를 모를 때 '다시 확인': 같은 키로 서버를 조회하고, 없으면 같은 요청을 다시 보낸다 */
export async function recheckCreate(): Promise<void> {
  const { attempt } = flow();
  if (!attempt) return;
  flow().set({ work: 'CREATE_SAVING' });
  try {
    const found = await orderService.getOrderByRequestKey(attempt.request.idempotencyKey);
    if (found) await onCreated(found, attempt.via, attempt.request.expectedCartRevision);
    else await send(attempt);
  } catch {
    flow().set({ work: 'CREATE_UNKNOWN' });
  }
}

const REJECTIONS: readonly string[] = ['PRICE_CHANGED', 'ITEM_UNAVAILABLE', 'ACCOUNT_REQUIRED', 'ACCOUNT_REVISION_CONFLICT'];

async function send(attempt: NonNullable<ReturnType<typeof flow>['attempt']>): Promise<void> {
  try {
    const order = await orderService.createOrder(attempt.request);
    await onCreated(order, attempt.via, attempt.request.expectedCartRevision);
  } catch (error) {
    const code = errorCode(error);
    if (code && REJECTIONS.includes(code)) {
      // 서버의 명확한 거절: 만들어지지 않았다. 확인한 뒤에는 새 키로 다시 시도할 수 있다
      flow().set({ work: 'CREATE_REJECTED', rejectedReason: code as RejectedReason, attempt: null });
      void clearAttempt();
    } else {
      // 시간 초과·네트워크 끊김·알 수 없는 오류: 주문이 만들어졌는지 모른다. 같은 키를 유지한다
      flow().set({ work: 'CREATE_UNKNOWN' });
    }
  }
}

/** 주문(PENDING) 저장에 성공했다 → 장바구니 정리 → 원격 설정 조회 → 이어가기 화면 */
async function onCreated(order: MockOrder, via: 'TOSS' | 'DIRECT', cartRevision: number): Promise<void> {
  flow().set({ order, work: 'PENDING_READY', attempt: null, rejectedReason: null, confirmOperationId: null, cancelOperationId: null });
  void clearAttempt();
  // 미결정 묶음2 #5(= 묶음1 #10): 주문 생성에 성공했을 때 비운다. 생성에 쓴 버전만 비우고 그사이 더 담은 것은 둔다 (ORD-013)
  if (UNDECIDED.cartClearTiming === 'onPendingCreated') await useCartStore.getState().clearIfRevision(cartRevision);
  syncHistory();
  await openTransfer(via);
}

/* ---------- 이어가기 (TRF-005 ~ 007) ---------- */

/** 실행 직전에 원격 설정을 조회한다. 3초 안에 답이 없으면 직접 이어가기로 간다 (TRF-005) */
export async function openTransfer(via: 'TOSS' | 'DIRECT', how: 'replace' | 'push' = 'replace'): Promise<void> {
  const timeout = new Promise<{ tossDeepLinkEnabled: boolean }>((resolve) =>
    setTimeout(() => resolve({ tossDeepLinkEnabled: false }), LIMITS.tossConfigTimeoutMs),
  );
  const config = await Promise.race([transferService.getTransferConfig(), timeout]).catch(() => ({ tossDeepLinkEnabled: false }));
  const direct = via === 'DIRECT' || !config.tossDeepLinkEnabled;
  flow().setTransfer({
    mode: direct ? 'DIRECT' : 'TOSS',
    tossConfigEnabled: config.tossDeepLinkEnabled,
    tossBusy: false,
    tossFailed: false,
    rawAvailable: true,
    awaitingReturn: false,
  });
  const target = direct ? '/order/direct' : '/order/continue';
  // 내역 탭에서 들어올 때는 push. replace하면 탭 화면 자체가 바뀐다
  if (how === 'push') router.push(target);
  else router.replace(target);
}

/** '토스로 주문 이어가기'. 실패하면 같은 주문의 직접 이어가기로 간다 (송금 실패라고 말하지 않는다) */
export async function openTossFromContinue(): Promise<void> {
  const { order, transfer } = flow();
  if (!order || transfer.tossBusy) return;
  flow().setTransfer({ tossBusy: true });
  try {
    await transferService.openToss({ orderId: order.orderId, prefill: UNDECIDED.tossPrefill });
    flow().setTransfer({ tossBusy: false, awaitingReturn: true });
  } catch {
    flow().setTransfer({ tossBusy: false, tossFailed: true, mode: 'DIRECT' });
    router.replace('/order/direct');
  }
}

/** 직접 이어가기의 '토스 열기'. 미리 채우지 않고 열기만 한다 */
export async function openTossPlain(): Promise<void> {
  const { order } = flow();
  if (!order) return;
  try {
    await transferService.openToss({ orderId: order.orderId, prefill: false });
    flow().setTransfer({ awaitingReturn: true });
  } catch {
    flow().setTransfer({ tossFailed: true });
  }
}

/** 계좌번호 복사. 인증 후 원문을 확인한 뒤 그 값만 복사한다. 확인하지 못하면 마스킹 번호로 대신하지 않는다 (TRF-007) */
export async function copyAccountNumber(): Promise<void> {
  const { order } = flow();
  if (!order) return;
  let raw: string;
  try {
    raw = await transferService.resolveDestinationAccountNumber(order.orderId);
  } catch {
    flow().setTransfer({ rawAvailable: false });
    return;
  }
  flow().setTransfer({ rawAvailable: true });
  await writeClipboard(raw, confirmedCopy.copiedAccount);
}

/** 금액 복사: 쉼표·'원' 없는 정수 문자열 (예: 27000) */
export async function copyAmount(): Promise<void> {
  const { order } = flow();
  if (!order) return;
  await writeClipboard(String(order.approvedTotalAmount), confirmedCopy.copiedAmount);
}

/** 쓰기에 성공했을 때만 성공 토스트를 보여준다 */
async function writeClipboard(value: string, successMessage: string): Promise<void> {
  try {
    await copyToClipboard(value);
    showToast({ message: successMessage, tone: 'success' });
  } catch {
    showToast({ message: draftCopy.transfer.copyFailed, tone: 'error' });
  }
}

/* ---------- 외부 앱에서 돌아옴 (TRF-008) ---------- */

/** 앱이 다시 앞으로 왔을 때. 외부 앱으로 보낸 기록이 있을 때만 서버 상태 확인을 시작한다 */
export function onAppForeground(): void {
  const { transfer, order } = flow();
  if (__DEV__) console.log('[return] foreground', { awaitingReturn: transfer.awaitingReturn, hasOrder: !!order });
  if (!transfer.awaitingReturn || !order) return;
  flow().setTransfer({ awaitingReturn: false });
  startReturnCheck('push');
}

/**
 * 서버 상태 확인 화면을 연다. 조회는 화면이 뜬 뒤에 그 화면이 시작한다 (runStatusQuery).
 * 화면을 열자마자 다른 화면으로 바꾸면, 기기에서는 화면 전환 애니메이션이 끝나기 전에 바꾸는 꼴이 되어
 * 확인 화면에 멈춰 버릴 수 있다. 웹에는 이 애니메이션이 없어서 문제없이 보인다.
 */
export function startReturnCheck(how: 'push' | 'replace' = 'replace'): void {
  if (!flow().order) return;
  if (how === 'push') router.push('/order/return-check');
  else router.replace('/order/return-check');
}

/** 이보다 오래 걸리면 조회 실패로 보고 오류 화면을 보여준다. 확인 화면에 무한히 머물지 않게 한다 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ServiceError('REQUEST_TIMEOUT', true)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

let statusQueryRunning = false;

/** 서버 상태를 먼저 조회하고 결과 화면으로 간다. 앱 전환은 송금의 증거가 아니다 (TRF-008) */
export async function runStatusQuery(): Promise<void> {
  const { order } = flow();
  if (!order || statusQueryRunning) return;
  statusQueryRunning = true;
  if (__DEV__) console.log('[return] status query start', order.orderId);
  try {
    const latest = await withTimeout(orderService.getOrderStatus(order.orderId), LIMITS.statusQueryTimeoutMs);
    if (__DEV__) console.log('[return] status query result', latest.status);
    flow().set({ order: latest });
    if (latest.status === 'USER_CONFIRMED') {
      flow().set({ work: 'SERVER_CONFIRMED' });
      router.replace('/order/done');
    } else if (latest.status === 'CANCELLED') {
      router.replace('/order/cancelled');
    } else {
      flow().set({ work: 'PENDING_READY' });
      router.replace('/order/question');
    }
  } catch (error) {
    if (__DEV__) console.log('[return] status query failed', errorCode(error));
    router.replace('/order/status-error');
  } finally {
    statusQueryRunning = false;
  }
}

/* ---------- 완료 확인 · 취소 (ORD-008 ~ 010) ---------- */

/**
 * '주문 완료했어요'. 서버로 보내기 전에 기기에 먼저 저장한다 (완료 확인 큐).
 * 서버 저장에 실패하면 같은 operationId로 다시 시도한다. 송금을 다시 하라는 안내는 하지 않는다.
 */
export async function confirmOrder(opts: { navigateToQuestion: boolean }): Promise<void> {
  const state = flow();
  const order = state.order;
  if (!order || state.work === 'CONFIRM_SYNCING') return;
  const operationId = state.confirmOperationId ?? createLocalId();
  if (opts.navigateToQuestion) router.replace('/order/question');
  flow().set({ work: 'CONFIRM_SYNCING', confirmOperationId: operationId });

  try {
    await saveConfirmQueue({
      version: 1,
      orderId: order.orderId,
      operationId,
      kind: 'CONFIRM',
      phase: 'QUEUED',
      createdLocallyAt: new Date().toISOString(),
      attemptCount: 1,
      lastErrorCode: null,
    });
  } catch {
    // 기기에 저장하지 못했다. 저장이 끝난 것처럼 보여주지 않는다
    flow().set({ work: 'CONFIRM_SAVE_FAILED' });
    return;
  }

  try {
    const confirmed = await orderService.confirmOrder(order.orderId, operationId);
    void clearConfirmQueue();
    flow().set({ order: confirmed, work: 'SERVER_CONFIRMED' });
    syncHistory();
    router.replace('/order/done');
  } catch (error) {
    if (errorCode(error) === 'INVALID_ORDER_TRANSITION') {
      // 다른 곳에서 이미 취소됐다. 서버 상태를 그대로 보여준다
      startReturnCheck('replace');
      return;
    }
    flow().set({ work: 'CONFIRM_SAVE_FAILED' });
  }
}

/** SaveEats 주문 기록을 취소한다 (PENDING만). 결과를 못 받으면 취소됐다고 단정하지 않는다 */
export async function cancelOrder(): Promise<void> {
  const state = flow();
  const order = state.order;
  if (!order) return;
  const operationId = state.cancelOperationId ?? createLocalId();
  flow().set({ cancelOperationId: operationId });
  try {
    const cancelled = await orderService.cancelOrder(order.orderId, operationId);
    flow().set({ order: cancelled, work: 'READY' });
    syncHistory();
    router.replace('/order/cancelled');
  } catch {
    flow().set({ work: 'CANCEL_UNKNOWN' });
  }
}

/** '아직이에요': PENDING을 그대로 두고 안내 화면으로. 상태 이력을 만들지 않는다 */
export function notYet(): void {
  router.replace('/order/not-yet');
}

/** 안내 화면의 '주문 이어가기': 같은 주문으로 이어가기 화면을 다시 연다 (새 주문을 만들지 않는다) */
export function resumeCurrentOrder(): void {
  const { transfer } = flow();
  flow().setTransfer({ tossFailed: false });
  router.replace(transfer.tossConfigEnabled ? '/order/continue' : '/order/direct');
}

/* ---------- 내역에서 이어가기 (HIST-004 · 009) ---------- */

/**
 * 내역의 '주문 이어하기': 같은 주문(orderId)으로 이어가기 화면을 다시 연다. 새 주문을 만들지 않는다.
 * 열기 전에 서버 상태를 다시 읽는다. 그사이 완료·취소됐으면 이어가기 대신 목록만 새로 맞춘다.
 * 이 주문의 완료 확인이 기기에 저장돼 있으면 이어가기가 아니라 '저장 다시 시도' 화면으로 보낸다.
 * 내역 탭 위에 쌓아야 하므로 replace가 아니라 push로 연다.
 */
export async function resumeOrderFromHistory(row: MockHistoryRow): Promise<boolean> {
  const { work } = flow();
  if (work === 'CREATE_UNKNOWN' || work === 'CREATE_SAVING' || work === 'CONFIRM_SYNCING') {
    showToast({ message: draftCopy.history.resumeBusy });
    return false;
  }
  let latest: MockOrder;
  try {
    latest = await orderService.getOrderStatus(row.orderId);
  } catch {
    showToast({ message: draftCopy.history.resumeFailed, tone: 'error' });
    return false;
  }
  if (latest.status !== 'PENDING') {
    // 이미 끝난 주문: 새 상태를 목록에 반영하고 이어가지 않는다
    showToast({ message: draftCopy.history.resumeAlreadyDone });
    syncHistory();
    void useHistoryStore.getState().loadFirst({ refresh: true });
    return false;
  }
  const queue = await loadConfirmQueue();
  const queued = queue?.orderId === latest.orderId;
  flow().set({ order: latest, attempt: null, rejectedReason: null, cancelOperationId: null, confirmOperationId: queued && queue ? queue.operationId : null });
  if (queued) {
    flow().set({ work: 'CONFIRM_SAVE_FAILED' });
    router.push('/order/question');
    return true;
  }
  flow().set({ work: 'PENDING_READY' });
  await openTransfer('TOSS', 'push');
  return true;
}

/** 내역의 '상태 저장 다시 시도': 기기에 저장된 같은 operationId로 완료 확인을 다시 보낸다 */
export async function retryQueuedConfirm(row: MockHistoryRow): Promise<void> {
  const queue = await loadConfirmQueue();
  if (!queue || queue.orderId !== row.orderId) {
    void useHistoryStore.getState().refreshQueue();
    return;
  }
  flow().set({ order: toOrder(row), attempt: null, confirmOperationId: queue.operationId, work: 'CONFIRM_SAVE_FAILED' });
  router.push('/order/question');
  await confirmOrder({ navigateToQuestion: false });
}
