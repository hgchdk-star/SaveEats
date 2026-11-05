const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('./harness.cjs');

const legacyKey = (uid) => `saveeats.order.confirmQueue.v2:${uid}`;
const legacyEntry = (orderId, operationId) => JSON.stringify({ version: 1, orderId, operationId, kind: 'CONFIRM', phase: 'SAVE_FAILED', createdLocallyAt: '2026-11-04T00:00:00Z', attemptCount: 2, lastErrorCode: 'X' });
const failConfirm = (w, ...ids) => { w.server.confirmError = (id) => (ids.includes(id) ? new w.ServiceError('REQUEST_TIMEOUT', true) : null); };

/* ---------- GAP-01 ---------- */

test('GAP-01 최초 주문 응답부터 주문 당시 목적지가 보이고 토스 경로로 간다', async () => {
  const w = createWorld();
  const order = await w.createThroughApp();
  assert.deepEqual(order.snapshot.destination, { bankName: '토스뱅크', last4: '3456' });
  assert.equal(w.flow().transfer.mode, 'TOSS');
  assert.equal(w.lastRoute(), '/order/continue');
});

test('GAP-01 생성 응답 유실 뒤 같은 키로 찾은 주문에 목적지가 붙고 새 주문을 만들지 않는다', async () => {
  const w = createWorld();
  w.server.loseCreateResponse = true;
  await w.actions.createOrder('TOSS', w.cart, w.account());
  assert.equal(w.flow().work, 'CREATE_UNKNOWN');
  await w.actions.recheckCreate();
  assert.equal(w.server.createCalls, 1);
  assert.deepEqual(w.flow().order.snapshot.destination, { bankName: '토스뱅크', last4: '3456' });
  assert.equal(w.lastRoute(), '/order/continue');
});

test('GAP-01 앱 재시작 복구로 찾은 주문도 목적지 연결이 남는다', async () => {
  const w = createWorld();
  w.server.loseCreateResponse = true;
  await w.actions.createOrder('TOSS', w.cart, w.account());
  w.flow().reset();
  await w.recoverOnStart();
  const found = await require('@/services').orderService.getOrderStatus('order-1');
  assert.equal(found.snapshot.destination?.bankName, '토스뱅크');
  assert.equal(w.server.createCalls, 1);
});

test('GAP-01 IDEMPOTENCY_CONFLICT로 찾은 다른 요청의 주문에는 이번 계좌를 잇지 않는다', async () => {
  const w = createWorld();
  const realAdd = w.server.add.bind(w.server);
  w.server.createError = new w.ServiceError('IDEMPOTENCY_CONFLICT');
  // 같은 키의 기존 주문을 만들어 둔다: 첫 전송 때 키를 알아야 하므로 저장된 시도에서 읽는다
  const orderService = require('@/services').orderService;
  const originalLookup = orderService.getOrderByRequestKey;
  orderService.getOrderByRequestKey = async (key) => { realAdd('other-order', 'PENDING', key); return originalLookup(key); };
  await w.actions.createOrder('TOSS', w.cart, w.account());
  assert.equal(w.flow().work, 'CREATE_CONFLICT');
  assert.equal(w.flow().order, null);
  assert.equal(w.flow().conflictOrder.orderId, 'other-order');
  assert.equal(w.flow().conflictOrder.snapshot.destination, null);
  const linked = [...w.storage.map.entries()].filter(([k]) => k.includes('destinationLinks')).map(([, v]) => v).join('');
  assert.equal(linked.includes('other-order'), false);
});

test('GAP-01 연결 저장에 실패하면 목적지 불명으로 두고 복사·토스를 막는다', async () => {
  const w = createWorld();
  w.storage.failSet = (key) => key.includes('destinationLinks');
  const order = await w.createThroughApp();
  assert.equal(order.snapshot.destination, null);
  assert.equal(w.flow().transfer.mode, 'DIRECT');
  assert.equal(w.flow().transfer.rawAvailable, false);
  await w.actions.copyAccountNumber();
  assert.equal(w.flow().transfer.rawAvailable, false);
  assert.equal(w.world.opened.length, 0);
});

test('GAP-01 연결 목록을 읽지 못하면 다른 주문의 연결을 지우지 않는다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  w.storage.failGet = (key) => key.includes('destinationLinks');
  w.flow().reset();
  await w.createThroughApp();
  w.storage.failGet = () => false;
  const first = await require('@/services').orderService.getOrderStatus('order-1');
  assert.equal(first.snapshot.destination?.bankName, '토스뱅크');
});

/* ---------- GAP-02 ---------- */

test('GAP-02 정상 조건에서만 사전입력 URL을 한 번 연다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  await w.actions.openTossFromContinue();
  assert.equal(w.world.opened.length, 1);
  assert.match(w.world.opened[0], /^supertoss:\/\/send\?amount=27000&bank=/);
  assert.equal(w.flow().transfer.awaitingReturn, true);
});

test('GAP-02 중복 클릭은 한 번만 실행한다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  await Promise.all([w.actions.openTossFromContinue(), w.actions.openTossFromContinue()]);
  assert.equal(w.world.opened.length, 1);
});

for (const [name, response] of [
  ['OFF', async () => ({ data: { configRevision: 3, fetchedAtServer: '2026-11-05T00:00:00Z', flags: { tossDeepLinkEnabled: false } }, error: null })],
  ['조회 오류', async () => ({ data: null, error: { message: 'x' } })],
  ['예외', async () => { throw new Error('network'); }],
  ['응답 없음(timeout)', () => new Promise(() => undefined)],
  ['boolean 아닌 값', async () => ({ data: { configRevision: 3, fetchedAtServer: '2026-11-05T00:00:00Z', flags: { tossDeepLinkEnabled: 'true' } }, error: null })],
  ['configRevision 누락', async () => ({ data: { fetchedAtServer: '2026-11-05T00:00:00Z', flags: { tossDeepLinkEnabled: true } }, error: null })],
  ['fetchedAtServer 잘못됨', async () => ({ data: { configRevision: 3, fetchedAtServer: 'nope', flags: { tossDeepLinkEnabled: true } }, error: null })],
]) {
  test(`GAP-02 화면 진입 뒤 원격이 ${name}이면 열지 않고 같은 주문의 직접 이어가기로 간다`, async () => {
    const w = createWorld();
    const order = await w.createThroughApp();
    w.world.configResponse = response;
    await w.actions.openTossFromContinue();
    assert.equal(w.world.opened.length, 0);
    assert.equal(w.lastRoute(), '/order/direct');
    assert.equal(w.flow().order.orderId, order.orderId);
    assert.equal(w.flow().transfer.tossBusy, false);
    assert.equal(w.server.createCalls, 1);
  });
}

for (const status of ['USER_CONFIRMED', 'CANCELLED']) {
  test(`GAP-02 서버에서 ${status}인 주문은 열지 않고 상태 확인으로 보낸다`, async () => {
    const w = createWorld();
    const order = await w.createThroughApp();
    w.server.orders.get(order.orderId).status = status;
    await w.actions.openTossFromContinue();
    assert.equal(w.world.opened.length, 0);
    assert.equal(w.lastRoute(), '/order/return-check');
    await w.actions.runStatusQuery();
    assert.equal(w.lastRoute(), status === 'CANCELLED' ? '/order/cancelled' : '/order/done');
  });
}

test('GAP-02 서버 상태를 읽지 못하면 열지 않는다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  w.server.statusError = new w.ServiceError('REQUEST_TIMEOUT', true);
  await w.actions.openTossFromContinue();
  assert.equal(w.world.opened.length, 0);
  assert.equal(w.lastRoute(), '/order/return-check');
});

test('GAP-02 완료 확인 대기가 있으면 열지 않고 같은 번호로 상태 저장 복구 화면을 연다', async () => {
  const w = createWorld();
  const order = await w.createThroughApp();
  failConfirm(w, order.orderId);
  await w.actions.confirmOrder({ navigateToQuestion: false });
  const operationId = w.flow().confirmOperationId;
  w.flow().set({ work: 'PENDING_READY', confirmOperationId: null });
  await w.actions.openTossFromContinue();
  assert.equal(w.world.opened.length, 0);
  assert.equal(w.flow().work, 'CONFIRM_SAVE_FAILED');
  assert.equal(w.flow().confirmOperationId, operationId);
  assert.equal(w.lastRoute(), '/order/question');
});

test('GAP-02 대기 기록을 읽지 못하면 없다고 단정하지 않고 열지 않는다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  w.storage.failGet = (key) => key.includes('confirmQueue');
  await w.actions.openTossFromContinue();
  assert.equal(w.world.opened.length, 0);
  assert.equal(w.lastRoute(), '/order/return-check');
});

test('GAP-02 검증 목록에 없는 은행·플랫폼은 열지 않는다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  w.world.platform = 'android';
  await w.actions.openTossFromContinue();
  assert.equal(w.world.opened.length, 0);
  assert.equal(w.lastRoute(), '/order/direct');
});

test('GAP-02 계좌가 바뀌어 목적지가 다르면 열지 않고 복사도 막는다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  w.world.vaultRef = 'ref-2';
  await w.actions.openTossFromContinue();
  assert.equal(w.world.opened.length, 0);
  assert.equal(w.flow().transfer.rawAvailable, false);
  assert.equal(w.lastRoute(), '/order/direct');
});

test('GAP-02 OS가 실행을 거절해도 자동 재실행하지 않고 직접 이어가기로 간다', async () => {
  const w = createWorld();
  await w.createThroughApp();
  w.world.openRejects = true;
  await w.actions.openTossFromContinue();
  assert.equal(w.flow().transfer.tossFailed, true);
  assert.equal(w.lastRoute(), '/order/direct');
  assert.equal(w.server.createCalls, 1);
});

/* ---------- GAP-03 ---------- */

test('GAP-03 A·B 두 주문의 완료 확인 대기가 함께 남고 내역에 둘 다 보인다', async () => {
  const w = createWorld();
  const a = w.server.add('A'); const b = w.server.add('B');
  failConfirm(w, 'A', 'B');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  w.focus(b); await w.actions.confirmOrder({ navigateToQuestion: false });
  await w.useHistoryStore.getState().refreshQueue();
  assert.deepEqual(Object.keys(w.useHistoryStore.getState().queuedConfirmOrderIds).sort(), ['A', 'B']);
});

test('GAP-03 복구는 주문마다 처리하고 한 주문의 실패가 다른 대기를 지우지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A'); const b = w.server.add('B');
  failConfirm(w, 'A', 'B');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  const opA = w.server.confirmCalls[0].operationId;
  w.focus(b); await w.actions.confirmOrder({ navigateToQuestion: false });
  failConfirm(w, 'B');
  w.server.confirmCalls.length = 0;
  await w.recoverOnStart();
  assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
  assert.equal(w.server.confirmCalls.find((c) => c.orderId === 'A').operationId, opA);
  await w.useHistoryStore.getState().refreshQueue();
  assert.deepEqual(Object.keys(w.useHistoryStore.getState().queuedConfirmOrderIds), ['B']);
  assert.equal(w.world.opened.length, 0);
  assert.equal(w.server.createCalls, 0);
});

test('GAP-03 B의 완료 성공이 A의 대기를 지우지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A'); const b = w.server.add('B');
  failConfirm(w, 'A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  w.focus(b); await w.actions.confirmOrder({ navigateToQuestion: false });
  assert.equal(w.server.orders.get('B').status, 'USER_CONFIRMED');
  await w.useHistoryStore.getState().refreshQueue();
  assert.deepEqual(Object.keys(w.useHistoryStore.getState().queuedConfirmOrderIds), ['A']);
});

test('GAP-03 앱을 다시 켠 뒤에도 같은 operationId로 재시도한다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  failConfirm(w, 'A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  await w.actions.confirmOrder({ navigateToQuestion: false });
  const [first, second] = w.server.confirmCalls;
  assert.equal(first.operationId, second.operationId);
  // 재시작: 메모리 상태만 사라지고 기기 기록은 남는다
  w.flow().reset();
  w.server.confirmError = () => null;
  await w.recoverOnStart();
  assert.equal(w.server.confirmCalls.at(-1).operationId, first.operationId);
  await w.useHistoryStore.getState().refreshQueue();
  assert.deepEqual(w.useHistoryStore.getState().queuedConfirmOrderIds, {});
});

test('GAP-03 기존 단일 큐는 잃지 않고 옮겨져 같은 operationId로 복구된다', async () => {
  const w = createWorld();
  w.server.add('A');
  w.storage.map.set(legacyKey('user-a'), legacyEntry('A', 'op-legacy'));
  await w.recoverOnStart();
  assert.deepEqual(w.server.confirmCalls, [{ orderId: 'A', operationId: 'op-legacy' }]);
  assert.equal(w.storage.map.has(legacyKey('user-a')), false);
});

test('GAP-03 이전 쓰기가 실패하면 기존 단일 큐를 남긴다', async () => {
  const w = createWorld();
  w.server.add('A');
  w.storage.map.set(legacyKey('user-a'), legacyEntry('A', 'op-legacy'));
  w.storage.failSet = (key) => key.includes('confirmQueue');
  await w.recoverOnStart();
  assert.equal(w.storage.map.has(legacyKey('user-a')), true);
  assert.equal(w.server.confirmCalls.length, 0);
  w.storage.failSet = () => false;
  await w.recoverOnStart();
  assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
});

test('GAP-03 큐 저장 실패는 저장된 것처럼 보이지 않고 서버로 보내지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  w.storage.failSet = (key) => key.includes('confirmQueue');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  assert.equal(w.flow().work, 'CONFIRM_SAVE_FAILED');
  assert.equal(w.server.confirmCalls.length, 0);
});

test('GAP-03 대기 기록을 읽지 못하면 내역 이어가기를 열지 않고 알고 있던 표시를 지우지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  failConfirm(w, 'A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  await w.useHistoryStore.getState().refreshQueue();
  w.flow().reset();
  w.storage.failGet = (key) => key === '*' || key.includes('confirmQueue');
  await w.useHistoryStore.getState().refreshQueue();
  assert.deepEqual(Object.keys(w.useHistoryStore.getState().queuedConfirmOrderIds), ['A']);
  const opened = await w.actions.resumeOrderFromHistory(a);
  assert.equal(opened, false);
  assert.equal(w.world.routes.includes('/order/direct') || w.world.routes.includes('/order/continue'), false);
  await w.recoverOnStart();
  assert.equal(w.server.confirmCalls.length, 1);
});

test('GAP-03 대기가 손상돼도 그 주문은 대기로 보고 다른 주문에 번지지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  failConfirm(w, 'A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  const key = [...w.storage.map.keys()].find((k) => k.includes('confirmQueue'));
  w.storage.map.set(key, '{broken');
  w.flow().reset();
  const opened = await w.actions.resumeOrderFromHistory(a);
  assert.equal(opened, true);
  assert.equal(w.flow().work, 'CONFIRM_SAVE_FAILED');
  assert.equal(w.lastRoute(), '/order/question');
});

test('GAP-03 내역 이어가기는 대기가 있으면 상태 저장 복구를 먼저 연다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  failConfirm(w, 'A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  const op = w.server.confirmCalls[0].operationId;
  w.flow().reset();
  await w.actions.resumeOrderFromHistory(a);
  assert.equal(w.flow().confirmOperationId, op);
  assert.equal(w.lastRoute(), '/order/question');
  assert.equal(w.world.opened.length, 0);
});

test('GAP-03 다른 계정은 이전 계정의 대기를 읽거나 처리하지 않고, 원래 계정에서 복구된다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  failConfirm(w, 'A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  w.server.confirmCalls.length = 0;
  w.signIn('user-b');
  await w.recoverOnStart();
  await w.useHistoryStore.getState().refreshQueue();
  assert.equal(w.server.confirmCalls.length, 0);
  assert.deepEqual(w.useHistoryStore.getState().queuedConfirmOrderIds, {});
  w.server.confirmError = () => null;
  w.signIn('user-a');
  await w.recoverOnStart();
  assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
});

test('GAP-03 서버 응답을 기다리는 사이 계정이 바뀌면 새 계정 화면과 큐를 건드리지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  let release;
  const base = require('@/services').orderService;
  const original = base.confirmOrder;
  base.confirmOrder = async (...args) => { await new Promise((r) => { release = r; }); return original(...args); };
  w.focus(a);
  const running = w.actions.confirmOrder({ navigateToQuestion: false });
  await new Promise((r) => setTimeout(r, 5));
  w.flow().reset();
  w.signIn('user-b');
  release();
  await running;
  assert.equal(w.flow().order, null);
  assert.equal(w.lastRoute() === '/order/done', false);
  const keysB = [...w.storage.map.keys()].filter((k) => k.includes('confirmQueue') && k.includes('user-b'));
  assert.equal(keysB.length, 0);
});

test('GAP-03 복구 중 계정이 바뀌면 남은 주문을 새 계정으로 보내지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A'); const b = w.server.add('B');
  failConfirm(w, 'A', 'B');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  w.focus(b); await w.actions.confirmOrder({ navigateToQuestion: false });
  w.server.confirmCalls.length = 0;
  w.server.confirmError = () => null;
  const base = require('@/services').orderService;
  const original = base.getOrderStatus;
  base.getOrderStatus = async (id) => { const r = await original(id); w.signIn('user-b'); return r; };
  await w.recoverOnStart();
  assert.equal(w.server.confirmCalls.length, 0);
});

test('안전: 계좌번호가 큐·시도 기록·일반 저장소에 남지 않는다', async () => {
  const w = createWorld();
  const order = await w.createThroughApp();
  await w.actions.openTossFromContinue();
  failConfirm(w, order.orderId);
  await w.actions.confirmOrder({ navigateToQuestion: false });
  assert.equal([...w.storage.map.values()].join('').includes('1002123456'), false);
  assert.equal([...w.world.secure.values()].join('').includes('1002123456'), false);
});

/* ---------- 개발 전용 실패 주입 · 취소 · 알려진 제한 ---------- */

/** 주입 모듈은 불러올 때 환경 값을 읽으므로 world를 만들기 전에 정한다 */
function withInjection(count, dev, fn) {
  const before = { env: process.env.EXPO_PUBLIC_DEV_CONFIRM_FAILURES, dev: globalThis.__DEV__ };
  process.env.EXPO_PUBLIC_DEV_CONFIRM_FAILURES = String(count);
  globalThis.__DEV__ = dev;
  return fn().finally(() => {
    if (before.env === undefined) delete process.env.EXPO_PUBLIC_DEV_CONFIRM_FAILURES;
    else process.env.EXPO_PUBLIC_DEV_CONFIRM_FAILURES = before.env;
    globalThis.__DEV__ = before.dev;
  });
}

test('주입 2회: 네트워크가 살아 있어도 A·B가 모두 대기로 남고, 서버는 받지 않으며, 재시작 복구가 둘 다 같은 번호로 완료한다', () =>
  withInjection(2, true, async () => {
    const w = createWorld();
    const a = w.server.add('A'); const b = w.server.add('B');
    w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
    const opA = w.flow().confirmOperationId;
    w.focus(b); await w.actions.confirmOrder({ navigateToQuestion: false });
    const opB = w.flow().confirmOperationId;
    assert.equal(w.server.confirmCalls.length, 0);
    assert.equal(w.server.orders.get('A').status, 'PENDING');
    assert.equal(w.server.orders.get('B').status, 'PENDING');
    assert.ok(w.world.toasts.filter((t) => t.message.includes('[개발용 실패 주입]')).length === 2);
    await w.useHistoryStore.getState().refreshQueue();
    assert.deepEqual(Object.keys(w.useHistoryStore.getState().queuedConfirmOrderIds).sort(), ['A', 'B']);
    // 앱 재시작: 메모리 상태만 사라진다. 복구는 주입 없이 실제 서버 경로로 간다
    w.flow().reset();
    await w.recoverOnStart();
    assert.deepEqual(w.server.confirmCalls.map((c) => [c.orderId, c.operationId]).sort(), [['A', opA], ['B', opB]]);
    assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
    assert.equal(w.server.orders.get('B').status, 'USER_CONFIRMED');
    await w.useHistoryStore.getState().refreshQueue();
    assert.deepEqual(w.useHistoryStore.getState().queuedConfirmOrderIds, {});
    assert.equal(w.server.createCalls, 0);
    assert.equal(w.world.opened.length, 0);
  }));

test('주입 소진 뒤 A만 재시도하면 A만 완료되고 B의 대기는 그대로다', () =>
  withInjection(2, true, async () => {
    const w = createWorld();
    const a = w.server.add('A'); const b = w.server.add('B');
    w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
    w.focus(b); await w.actions.confirmOrder({ navigateToQuestion: false });
    await w.actions.retryQueuedConfirm(a);
    assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
    assert.equal(w.server.orders.get('B').status, 'PENDING');
    await w.useHistoryStore.getState().refreshQueue();
    assert.deepEqual(Object.keys(w.useHistoryStore.getState().queuedConfirmOrderIds), ['B']);
  }));

test('릴리스 빌드(__DEV__ 꺼짐)에서는 값이 있어도 주입하지 않는다', () =>
  withInjection(2, false, async () => {
    const w = createWorld();
    const a = w.server.add('A');
    w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
    assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
    assert.equal(w.world.toasts.length, 0);
  }));

test('값이 없으면 주입하지 않는다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  w.focus(a); await w.actions.confirmOrder({ navigateToQuestion: false });
  assert.equal(w.server.orders.get('A').status, 'USER_CONFIRMED');
});

test('완료 확인 질문 화면에서 취소하면 서버 CANCELLED와 취소 화면으로 간다 (화면 진입 경로는 별도 문제)', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  w.focus(a);
  await w.actions.cancelOrder();
  assert.equal(w.server.orders.get('A').status, 'CANCELLED');
  assert.equal(w.lastRoute(), '/order/cancelled');
  assert.equal(w.flow().cancelledByUser, true);
});

test('취소된 주문의 완료 확인 대기는 복구가 지운다 (코드 주석: 서정 확정 2026-11-04)', async () => {
  const w = createWorld();
  w.server.add('A');
  failConfirm(w, 'A');
  w.focus(w.server.orders.get('A')); await w.actions.confirmOrder({ navigateToQuestion: false });
  w.server.orders.get('A').status = 'CANCELLED';
  await w.recoverOnStart();
  await w.useHistoryStore.getState().refreshQueue();
  assert.deepEqual(w.useHistoryStore.getState().queuedConfirmOrderIds, {});
  assert.equal(w.server.confirmCalls.length, 1); // 처음 실패한 시도뿐. 복구가 같은 확인을 다시 보내지 않았다
});

test('알려진 제한(결정 대기): 해석할 수 없는 예전 형식(v2) 기록이 있으면 모든 대기 조회가 판독 불가가 되어 이어가기·토스가 계속 막힌다', async () => {
  const w = createWorld();
  const a = w.server.add('A');
  w.storage.map.set(legacyKey('user-a'), '{broken');
  assert.equal((await w.confirmQueue.readConfirmEntry('A')).status, 'UNREADABLE');
  assert.equal((await w.confirmQueue.listConfirmEntries()).status, 'UNREADABLE');
  assert.equal(await w.actions.resumeOrderFromHistory(a), false);
  assert.equal(w.storage.map.get(legacyKey('user-a')), '{broken'); // 기록은 지우지 않는다
});
