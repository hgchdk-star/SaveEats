/**
 * "송금하지 않았어요" 정정(correct_order_completion) 호출 경계 테스트.
 * 실제 서비스 코드(src)를 변환해 실행하고 Supabase 클라이언트만 메모리 대역으로 바꾼다. 실서버·실제 앱 화면 테스트가 아니다.
 * 성공 응답 모양은 서버 migration(20261112000000)을 임시 Postgres에 적용해 실제로 받은 값이다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const srcRoot = path.join(root, 'src') + path.sep;
globalThis.__DEV__ = false;
for (const ext of ['.ts', '.tsx']) {
  require.extensions[ext] = (module, filename) => {
    const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true, jsx: ts.JsxEmit.React },
      fileName: filename,
    });
    module._compile(outputText, filename);
  };
}
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (request.startsWith('@/')) return originalResolve.call(this, path.join(srcRoot, request.slice(2)), ...rest);
  return originalResolve.call(this, request, ...rest);
};

let rpcImpl = async () => ({ data: null, error: null });
const calls = [];
const stubs = {
  '@/services/supabase/client': {
    getSupabaseClient: () => ({
      rpc: (name, args) => {
        calls.push({ name, args });
        return { abortSignal: () => rpcImpl(name, args) };
      },
    }),
  },
};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};

const { createSupabaseHistoryService } = require('@/services/order/supabase-history-service');
const { ServiceError } = require('@/services/service-error');
const service = createSupabaseHistoryService({});

const ORDER_ID = '2c886343-e7ad-4345-b05c-3e4394da7f23';
const OP_ID = '7a1f3c52-0d3b-4c7e-9a52-7b9d3e1f0a11';
// 서버(correct_order_completion = get_my_order || replayed)가 실제로 돌려준 모양
const corrected = (replayed) => ({
  status: 'CANCELLED', orderId: ORDER_ID, replayed,
  snapshot: {
    items: [{ menuId: 'f31e1eef-20f6-4733-a18c-538073e78396', options: [], menuName: 'New 오리지널', quantity: 1, lineTotal: 17900, unitPrice: 17900, menuImageRef: null }],
    store: { id: '67f6274e-0ac0-bd89-2f9b-1ec09a2253fc', name: '굽네치킨', imageRef: null, categoryName: '치킨' },
  },
  createdAt: '2026-11-18T14:19:32.724056+09:00', cancelledAt: '2026-11-18T14:19:32.729024+09:00', completedAt: null, totalAmount: 17900, statusRevision: 3,
});
const reset = () => { calls.length = 0; };

test('정정은 correct_order_completion을 p_order_id · p_operation_id로 호출한다', async () => {
  reset();
  rpcImpl = async () => ({ data: corrected(false), error: null });
  await service.correctOrderCompletion(ORDER_ID, OP_ID);
  assert.deepEqual(calls, [{ name: 'correct_order_completion', args: { p_order_id: ORDER_ID, p_operation_id: OP_ID } }]);
});

test('정정 성공 응답은 취소(CANCELLED)이고 완료 시각이 비어 있다', async () => {
  reset();
  rpcImpl = async () => ({ data: corrected(false), error: null });
  const { order, replayed } = await service.correctOrderCompletion(ORDER_ID, OP_ID);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(order.completedAt, null);
  assert.equal(order.statusRevision, 3);
  assert.equal(replayed, false);
});

test('같은 번호로 다시 보낸 정정은 오류 없이 기존 결과(replayed)로 받는다', async () => {
  reset();
  rpcImpl = async () => ({ data: corrected(true), error: null });
  const { order, replayed } = await service.correctOrderCompletion(ORDER_ID, OP_ID);
  assert.equal(order.status, 'CANCELLED');
  assert.equal(replayed, true);
});

for (const code of ['INVALID_ORDER_TRANSITION', 'ORDER_HAS_REVIEW', 'RESOURCE_NOT_FOUND', 'OPERATION_CONFLICT', 'AUTH_REQUIRED']) {
  test(`서버 업무 오류 ${code}는 같은 코드로 전달되고 성공으로 바뀌지 않는다`, async () => {
    reset();
    rpcImpl = async () => ({ data: null, error: { code: 'P0001', message: code } });
    await assert.rejects(() => service.correctOrderCompletion(ORDER_ID, OP_ID), (e) => e instanceof ServiceError && e.code === code && e.outcomeUnknown === false);
  });
}

test('서버에 정정 함수가 없으면(PGRST202) SERVER_FUNCTION_UNAVAILABLE로 구분하고 적용 여부 모름이 아니다', async () => {
  reset();
  rpcImpl = async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.correct_order_completion(p_operation_id, p_order_id) in the schema cache' } });
  await assert.rejects(() => service.correctOrderCompletion(ORDER_ID, OP_ID), (e) => e instanceof ServiceError && e.code === 'SERVER_FUNCTION_UNAVAILABLE' && e.outcomeUnknown === false);
});

test('응답을 받지 못하면(연결 실패·시간 초과) 적용 여부를 모르는 오류로 남는다', async () => {
  reset();
  rpcImpl = async () => { throw new Error('network'); };
  await assert.rejects(() => service.correctOrderCompletion(ORDER_ID, OP_ID), (e) => e instanceof ServiceError && e.outcomeUnknown === true);
});

test('알 수 없는 서버 오류(코드 있음)는 성공이 아니며 적용 여부 모름으로 남는다', async () => {
  reset();
  rpcImpl = async () => ({ data: null, error: { code: 'XX000', message: 'internal' } });
  await assert.rejects(() => service.correctOrderCompletion(ORDER_ID, OP_ID), (e) => e instanceof ServiceError && e.code === 'ORDER_FAILED' && e.outcomeUnknown === true);
});

test('주문 모양이 아닌 응답은 성공으로 받지 않는다(INVALID_RESPONSE)', async () => {
  reset();
  rpcImpl = async () => ({ data: { orderId: ORDER_ID, replayed: false }, error: null });
  await assert.rejects(() => service.correctOrderCompletion(ORDER_ID, OP_ID), (e) => e instanceof ServiceError && e.code === 'INVALID_RESPONSE');
});
