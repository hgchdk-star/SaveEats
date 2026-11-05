/**
 * 주문 흐름 시나리오 테스트의 공통 준비. 의존성을 추가하지 않고 node --test로 돌린다.
 * src의 실제 TS 모듈을 변환해 실행하고, 기기·서버 경계(저장소, Linking, 라우터, Supabase, 서버 주문)만 메모리 대역으로 바꾼다.
 * 실제 앱·실기기·실서버 테스트가 아니다. 토스는 열리지 않고 돈도 움직이지 않는다. 계좌번호는 가짜 값이다.
 */
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = process.env.SAVEEATS_TEST_ROOT || path.resolve(__dirname, '../..');
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

let stubs = {};
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return originalLoad.call(this, request, ...rest);
};

class MemoryStorage {
  constructor() {
    this.map = new Map();
    this.failGet = () => false;
    this.failSet = () => false;
  }
  async getItem(key) {
    if (this.failGet(key)) throw new Error('storage read failed');
    return this.map.has(key) ? this.map.get(key) : null;
  }
  async setItem(key, value) {
    if (this.failSet(key)) throw new Error('storage write failed');
    this.map.set(key, value);
  }
  async removeItem(key) {
    this.map.delete(key);
  }
  async getAllKeys() {
    if (this.failGet('*')) throw new Error('storage read failed');
    return [...this.map.keys()];
  }
}

const STORE_ID = 'store-1';
const AMOUNT = 27000;

class FakeServer {
  constructor(ServiceError) {
    this.ServiceError = ServiceError;
    this.orders = new Map();
    this.keys = new Map();
    this.createCalls = 0;
    this.confirmCalls = [];
    this.loseCreateResponse = false;
    this.createError = null;
    this.confirmError = () => null;
    this.statusError = null;
  }
  add(orderId, status = 'PENDING', key = `key-${orderId}`) {
    const order = {
      orderId, idempotencyKey: key, status, statusRevision: 1, createdAt: '2026-11-05T00:00:00Z', completedAt: null, cancelledAt: null,
      approvedTotalAmount: AMOUNT,
      snapshot: { storeId: STORE_ID, storeName: '가게', storeImageRef: null, categoryName: '치킨', items: [], destination: null },
    };
    this.orders.set(orderId, order);
    this.keys.set(key, orderId);
    return order;
  }
  service() {
    const clone = (o) => JSON.parse(JSON.stringify(o));
    return {
      createOrder: async (request) => {
        this.createCalls += 1;
        if (this.createError) throw this.createError;
        const order = this.add(`order-${this.createCalls}`, 'PENDING', request.idempotencyKey);
        order.approvedTotalAmount = request.approvedTotalAmount;
        if (this.loseCreateResponse) throw new this.ServiceError('REQUEST_TIMEOUT', true);
        return clone(order);
      },
      getOrderByRequestKey: async (key) => (this.keys.has(key) ? clone(this.orders.get(this.keys.get(key))) : null),
      getOrderStatus: async (orderId) => {
        if (this.statusError) throw this.statusError;
        if (!this.orders.has(orderId)) throw new this.ServiceError('RESOURCE_NOT_FOUND');
        return clone(this.orders.get(orderId));
      },
      confirmOrder: async (orderId, operationId) => {
        this.confirmCalls.push({ orderId, operationId });
        const failure = this.confirmError(orderId);
        if (failure) throw failure;
        this.orders.get(orderId).status = 'USER_CONFIRMED';
        return clone(this.orders.get(orderId));
      },
      cancelOrder: async (orderId) => {
        this.orders.get(orderId).status = 'CANCELLED';
        return clone(this.orders.get(orderId));
      },
    };
  }
}

/** 시나리오마다 새 세계를 만든다. 검증된 조합은 ios:토스뱅크 하나만 넣은 테스트 값이다 */
function createWorld() {
  for (const key of Object.keys(require.cache)) if (key.startsWith(srcRoot)) delete require.cache[key];
  process.env.EXPO_PUBLIC_TOSS_PREFILL_VERIFIED = 'ios:토스뱅크';
  delete process.env.EXPO_PUBLIC_DATA_SOURCE;

  const storage = new MemoryStorage();
  const secure = new Map();
  const world = {
    storage, secure, opened: [], routes: [], toasts: [], openRejects: false,
    configResponse: async () => ({ data: { configRevision: 2, fetchedAtServer: '2026-11-05T00:00:00Z', flags: { tossDeepLinkEnabled: true } }, error: null }),
    vaultRef: 'ref-1', platform: 'ios',
  };
  const services = {};
  stubs = {
    'react-native': {
      Platform: { get OS() { return world.platform; } },
      Linking: { openURL: async (url) => { if (world.openRejects) throw new Error('rejected'); world.opened.push(url); } },
      AppState: { addEventListener: () => ({ remove() {} }) },
    },
    'expo-router': {
      router: {
        replace: (r) => world.routes.push(r), push: (r) => world.routes.push(r), navigate: (r) => world.routes.push(r), back() {}, dismissAll() {},
      },
    },
    '@react-native-async-storage/async-storage': { __esModule: true, default: storage },
    '@/infrastructure/local/secure-store': {
      deviceSecureStore: { get: async (k) => secure.get(k) ?? null, set: async (k, v) => void secure.set(k, v), remove: async (k) => void secure.delete(k) },
    },
    '@/services/supabase/client': {
      getSupabaseClient: () => ({ rpc: () => ({ abortSignal: () => world.configResponse() }) }),
    },
    '@/services': services,
    '@/services/clipboard': { copyToClipboard: async () => undefined },
    '@/features/toast/toast-store': { showToast: (t) => world.toasts.push(t) },
    '@/features/cart/cart-store': { useCartStore: { getState: () => ({ clearIfRevision: async () => undefined }) } },
  };

  const { ServiceError, errorCode } = require('@/services/service-error');
  const server = new FakeServer(ServiceError);
  const session = require('@/services/session');
  const { LIMITS } = require('@/config/limits');
  LIMITS.tossConfigTimeoutMs = 30;
  const { withLocalDestination, withLocalDestinationHistory } = require('@/services/order/with-local-destination');
  const { createRealTransferService } = require('@/services/transfer/real-transfer-service');
  const { createDestinationResolver } = require('@/services/transfer/destination-resolver');
  let confirmQueue = null;
  try { confirmQueue = require('@/services/order/confirm-queue'); } catch { /* 수정 전 코드에는 없다 */ }

  const vault = {
    getCurrent: async () => (world.vaultRef ? { destinationRef: world.vaultRef } : null),
    readCurrentAccountNumber: async () => '1002123456',
  };
  const orderService = withLocalDestination(server.service());
  Object.assign(services, {
    orderService,
    historyService: withLocalDestinationHistory({
      listMyOrders: async () => ({ rows: [], nextCursor: null, hasMore: false }),
      getMyOrder: async () => { throw new Error('unused'); },
      getUnreadSummary: async () => ({ unreadEvents: [] }),
    }),
    transferService: createRealTransferService({
      resolveDestinationAccountNumber: createDestinationResolver(vault),
      getOrder: (id) => orderService.getOrderStatus(id),
      readConfirmState: (id) => confirmQueue.readConfirmEntry(id),
    }),
  });

  const actions = require('@/features/order/order-actions');
  const { recoverOnStart } = require('@/features/order/recovery');
  const { useOrderFlowStore } = require('@/features/order/order-flow-store');
  const { useHistoryStore } = require('@/features/history/history-store');
  const flow = () => useOrderFlowStore.getState();

  const account = (id = world.vaultRef) => ({ id, revision: 1, bankCode: 'TOSS', bankName: '토스뱅크', last4: '3456' });
  const cart = {
    storeId: STORE_ID, localRevision: 1,
    items: [{ menuId: 'menu-1', optionIds: [], quantity: 1, acknowledgedUnitPrice: AMOUNT, acknowledgedCatalogRevision: 1 }],
  };
  const signIn = (userId = 'user-a') => {
    session.setSessionUser({ userId, email: null });
    session.setSessionDestinationAccount(account());
  };
  /** 주문을 만들어 토스 이어가기 화면까지 온다 */
  const createThroughApp = async () => {
    await actions.createOrder('TOSS', cart, account());
    return flow().order;
  };
  /** 이 주문을 현재 주문으로 놓는다 */
  const focus = (order) => flow().set({ order, work: 'PENDING_READY', confirmOperationId: null });
  const lastRoute = () => world.routes[world.routes.length - 1];

  signIn();
  return { world, server, storage, session, actions, recoverOnStart, flow, useHistoryStore, signIn, createThroughApp, focus, lastRoute, cart, account, ServiceError, errorCode, confirmQueue };
}

module.exports = { createWorld };
