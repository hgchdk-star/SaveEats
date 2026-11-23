/**
 * 가게 상세: 고정 영역(검색+그룹 탭) 계산, 검색 시작·끝 전환, 목록에서 바로 담기.
 * 화면 없이 순수 로직과 실제 장바구니 모델로 시험한다. 실제 화면(고정·스크롤 체감, 키보드)은 기기에서 확인해야 한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('../order/harness.cjs'); // TS 변환 준비
const ms = require('../../src/features/store/menu-sections.ts');
const cartModel = require('../../src/features/cart/cart-model.ts');
const qa = require('../../src/features/cart/quick-add.ts');

/* ---------- 고정 영역 · 검색 전환 ---------- */

test('검색어가 비어 있다가 생기면 START, 있다가 비면(공백뿐 포함) END, 그 외는 NONE', () => {
  assert.equal(ms.searchTransition('', '치'), 'START');
  assert.equal(ms.searchTransition('  ', '치'), 'START');
  assert.equal(ms.searchTransition('치', '치킨'), 'NONE');
  assert.equal(ms.searchTransition('치킨', ''), 'END');
  assert.equal(ms.searchTransition('치킨', '   '), 'END');
  assert.equal(ms.searchTransition('', ''), 'NONE');
});

test('검색을 시작할 때: 고정 영역 아래쪽으로 스크롤돼 있으면 결과가 고정 영역 바로 아래에서 시작하게 올리고, 이미 위쪽이면 움직이지 않는다', () => {
  const anchorY = 600; // 고정 영역이 원래 놓인 위치
  const bar = 100;     // 상단 바
  assert.equal(ms.searchAnchorScroll(1500, anchorY, bar), 500);
  assert.equal(ms.searchAnchorScroll(500, anchorY, bar), null);
  assert.equal(ms.searchAnchorScroll(0, anchorY, bar), null);
  assert.equal(ms.searchAnchorScroll(10, 50, 100), 0, '앵커가 상단 바보다 위면 맨 위(0) 기준');
  assert.equal(ms.searchAnchorScroll(0, 50, 100), null);
});

test('고정 구간: 고정 영역은 스크롤 0에서 원래 자리, anchorY - barHeight만큼 내려오면 상단 바 아래에 멈춘다', () => {
  assert.deepEqual(ms.stickyScrollRange(600, 100), [0, 500]);
  assert.deepEqual(ms.stickyScrollRange(80, 100), [0, 1], '구간은 항상 증가해야 한다(최소 1)');
});

test('그룹 탭 이동 높이: 고정 영역(검색+탭) 높이까지 포함해 구역 제목이 가려지지 않는다', () => {
  const bar = 100, search = 64, tabs = 44;
  const header = bar + search + tabs; // 208
  const sectionY = 1200;
  const target = ms.scrollTargetForSection(sectionY, header);
  assert.equal(target, 992);
  // 그 위치에서 구역 제목은 화면 y = 1200 - 992 = 208, 곧 고정 영역 바로 아래다
  assert.equal(sectionY - target, header);
  assert.equal(ms.activeSectionIndex([300, 1200, 2000], target, header), 1);
});

test('검색 중에는 고정 영역이 검색창만이라 높이가 줄어든다 → 계산이 같은 식으로 맞춰진다', () => {
  const bar = 100, search = 64;
  const withTabs = ms.scrollTargetForSection(1000, bar + search + 44);
  const searchOnly = ms.scrollTargetForSection(1000, bar + search);
  assert.equal(searchOnly - withTabs, 44);
});

/* ---------- 목록에서 바로 담기 ---------- */

const STORE = 'store-1';
const menu = (over = {}) => ({
  id: 'm1', storeId: STORE, storeIsOpen: true, name: '치킨', description: null, imageRef: null, price: 20000, catalogRevision: 7, isSoldOut: false, optionGroups: [], ...over,
});
const group = (id, minSelect, maxSelect, options = [{ id: id + '-a', name: 'A', additionalPrice: 500, isSoldOut: false }]) => ({ id, name: id, minSelect, maxSelect, options });

/** 실제 장바구니 모델(addToCart)로 동작하는 담기 대역. 저장 실패는 failSave로 만든다 */
function fakeCart(initial) {
  const state = { cart: initial ?? cartModel.createEmptyCart(), addCalls: 0, failSave: false, getMenuCalls: 0 };
  return {
    state,
    add: async (input, options) => {
      state.addCalls += 1;
      if (state.failSave) return { ok: false, reason: 'SAVE_FAILED' };
      const r = cartModel.addToCart(state.cart, input, options);
      if (!r.ok) return { ok: false, reason: r.reason };
      state.cart = r.cart;
      return { ok: true };
    },
  };
}
const deps = (cart, getMenu, preparingStoreOrderable = false) => ({
  getMenu: async (id) => { cart.state.getMenuCalls += 1; return getMenu(id); },
  add: cart.add,
  preparingStoreOrderable,
});

test('필수 옵션이 없는 메뉴는 상세 없이 옵션 없이 1개로 담긴다(가격·revision은 방금 조회한 값)', async () => {
  const cart = fakeCart();
  const out = await qa.quickAddMenu('m1', deps(cart, () => menu()));
  assert.deepEqual(out, { kind: 'ADDED' });
  assert.equal(cart.state.cart.items.length, 1);
  const item = cart.state.cart.items[0];
  assert.equal(item.quantity, 1);
  assert.deepEqual(item.optionIds, []);
  assert.equal(item.acknowledgedUnitPrice, 20000);
  assert.equal(item.acknowledgedCatalogRevision, 7);
});

test('선택 옵션만 있는 메뉴(minSelect 0)도 옵션 없이 바로 담긴다', async () => {
  const cart = fakeCart();
  const out = await qa.quickAddMenu('m1', deps(cart, () => menu({ optionGroups: [group('g1', 0, 1000), group('g2', 0, 2)] })));
  assert.deepEqual(out, { kind: 'ADDED' });
  assert.deepEqual(cart.state.cart.items[0].optionIds, []);
});

test('필수 옵션(minSelect ≥ 1)이 하나라도 있으면 상세로 보내고 아무것도 담지 않는다(자동 선택·기본값 확정 없음)', async () => {
  const cart = fakeCart();
  for (const groups of [[group('g1', 1, 1)], [group('g0', 0, 5), group('g1', 2, 3)], [group('g1', 1, 1000)]]) {
    const out = await qa.quickAddMenu('m1', deps(cart, () => menu({ optionGroups: groups })));
    assert.deepEqual(out, { kind: 'NEEDS_DETAIL' });
  }
  assert.equal(cart.state.addCalls, 0, '장바구니 추가를 한 번도 호출하지 않는다');
  assert.equal(cart.state.cart.items.length, 0);
});

test('필수 여부는 그룹 이름·문구가 아니라 minSelect로만 판단한다', async () => {
  const cart = fakeCart();
  const optionalButNamedRequired = { ...group('g1', 0, 1), name: '[필수] 부위 선택' };
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, () => menu({ optionGroups: [optionalButNamedRequired] }))), { kind: 'ADDED' });
  const cart2 = fakeCart();
  const requiredButPlainName = { ...group('g1', 1, 1), name: '추가' };
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart2, () => menu({ optionGroups: [requiredButPlainName] }))), { kind: 'NEEDS_DETAIL' });
});

test('상세 조회 실패는 "필수 옵션 없음"으로 처리하지 않는다: 담지 않고 실패로 알린다', async () => {
  const cart = fakeCart();
  const out = await qa.quickAddMenu('m1', deps(cart, () => { throw new Error('network'); }));
  assert.deepEqual(out, { kind: 'FAILED', reason: 'LOAD_FAILED' });
  assert.equal(cart.state.addCalls, 0);
  assert.equal(cart.state.cart.items.length, 0);
});

test('품절·영업 종료(설정상 담기 불가) 메뉴는 담지 않는다', async () => {
  const cart = fakeCart();
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, () => menu({ isSoldOut: true }))), { kind: 'BLOCKED', reason: 'SOLD_OUT' });
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, () => menu({ storeIsOpen: false }), false)), { kind: 'BLOCKED', reason: 'STORE_CLOSED' });
  assert.equal(cart.state.addCalls, 0);
  // 준비 중 가게도 담을 수 있게 설정되어 있으면 담는다
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, () => menu({ storeIsOpen: false }), true)), { kind: 'ADDED' });
});

test('품절 판단은 방금 조회한 최신 상세 기준이다(목록이 오래돼도 담기지 않는다)', async () => {
  const cart = fakeCart();
  let sold = false;
  const getMenu = () => menu({ isSoldOut: sold });
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, getMenu)), { kind: 'ADDED' });
  sold = true; // 그 사이 품절
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, getMenu)), { kind: 'BLOCKED', reason: 'SOLD_OUT' });
  assert.equal(cart.state.cart.items[0].quantity, 1, '품절 뒤 수량이 늘지 않는다');
});

test('같은 메뉴·같은 옵션 구성은 기존 병합 정책대로 수량이 합쳐진다', async () => {
  const cart = fakeCart();
  await qa.quickAddMenu('m1', deps(cart, () => menu()));
  await qa.quickAddMenu('m1', deps(cart, () => menu()));
  assert.equal(cart.state.cart.items.length, 1);
  assert.equal(cart.state.cart.items[0].quantity, 2);
});

test('같은 조합 합계가 10을 넘으면 담지 않고 OVER_LIMIT, 기존 수량을 줄이지 않는다', async () => {
  const cart = fakeCart();
  for (let i = 0; i < 10; i += 1) assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, () => menu())), { kind: 'ADDED' });
  assert.equal(cart.state.cart.items[0].quantity, 10);
  assert.deepEqual(await qa.quickAddMenu('m1', deps(cart, () => menu())), { kind: 'FAILED', reason: 'OVER_LIMIT' });
  assert.equal(cart.state.cart.items[0].quantity, 10);
});

test('다른 가게 메뉴가 담겨 있으면 담지 않고 OTHER_STORE → 교체 확인 후(replaceOtherStore) 담긴다', async () => {
  const cart = fakeCart();
  await qa.quickAddMenu('m1', deps(cart, () => menu()));
  const other = () => menu({ id: 'x1', storeId: 'store-2', name: '다른 가게 메뉴' });
  const first = await qa.quickAddMenu('x1', deps(cart, other));
  assert.deepEqual(first, { kind: 'OTHER_STORE' });
  assert.equal(cart.state.cart.items.length, 1);
  assert.equal(cart.state.cart.items[0].menuId, 'm1', '확인 전에는 기존 장바구니가 그대로다');
  const second = await qa.quickAddMenu('x1', deps(cart, other), { replaceOtherStore: true });
  assert.deepEqual(second, { kind: 'ADDED' });
  assert.equal(cart.state.cart.items.length, 1);
  assert.equal(cart.state.cart.items[0].menuId, 'x1');
});

test('저장 실패(SAVE_FAILED)는 성공으로 보지 않고 장바구니도 늘지 않는다', async () => {
  const cart = fakeCart();
  cart.state.failSave = true;
  const out = await qa.quickAddMenu('m1', deps(cart, () => menu()));
  assert.deepEqual(out, { kind: 'FAILED', reason: 'SAVE_FAILED' });
  assert.equal(cart.state.cart.items.length, 0);
});

/* ---------- 연속 터치 ---------- */

test('처리 중에는 같은 버튼을 다시 눌러도, 다른 카드의 버튼을 눌러도 무시한다(같은 프레임 연속 터치 포함)', async () => {
  const flight = qa.createSingleFlight();
  assert.equal(flight.tryStart('m1'), true);
  assert.equal(flight.tryStart('m1'), false);
  assert.equal(flight.tryStart('m2'), false);
  assert.equal(flight.current, 'm1');
  flight.finish();
  assert.equal(flight.current, null);
  assert.equal(flight.tryStart('m2'), true);
});

test('연속 터치를 잠금으로 막으면 같은 메뉴가 한 번만 담기고 요청도 한 번만 나간다', async () => {
  const cart = fakeCart();
  const flight = qa.createSingleFlight();
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowGetMenu = async () => { await gate; return menu(); };
  const tap = async () => {
    if (!flight.tryStart('m1')) return 'IGNORED';
    try { return await qa.quickAddMenu('m1', { getMenu: slowGetMenu, add: cart.add, preparingStoreOrderable: false }); } finally { flight.finish(); }
  };
  const first = tap();
  const second = tap(); // 같은 프레임의 두 번째 터치
  release();
  const results = await Promise.all([first, second]);
  assert.equal(results.filter((r) => r === 'IGNORED').length, 1);
  assert.equal(cart.state.cart.items.length, 1);
  assert.equal(cart.state.cart.items[0].quantity, 1);
  assert.equal(cart.state.addCalls, 1);
});

test('처리가 실패로 끝나도 잠금이 풀려 다시 누를 수 있다', async () => {
  const cart = fakeCart();
  const flight = qa.createSingleFlight();
  assert.equal(flight.tryStart('m1'), true);
  try { await qa.quickAddMenu('m1', deps(cart, () => { throw new Error('x'); })); } finally { flight.finish(); }
  assert.equal(flight.tryStart('m1'), true);
});

test('고정 영역 위치: 오버스크롤(음수)은 본문과 같은 거리만큼 내려오고, 0 이상은 기존처럼 올라가다 멈춘다', () => {
  // Animated interpolate와 같은 방식: 구간별 선형, 왼쪽은 연장, 오른쪽은 고정
  const at = (anchorY, bar, x) => {
    const { inputRange: i, outputRange: o } = ms.stickyTranslateInterpolation(anchorY, bar);
    if (x >= i[i.length - 1]) return o[o.length - 1];
    let k = x < i[1] ? 0 : 1;
    return o[k] + ((x - i[k]) * (o[k + 1] - o[k])) / (i[k + 1] - i[k]);
  };
  assert.equal(at(600, 100, 0), 600, '맨 위: 원래 자리');
  assert.equal(at(600, 100, -40), 640, '40만큼 당기면 40만큼 내려온다');
  assert.equal(at(600, 100, -120), 720);
  assert.equal(at(600, 100, 200), 400, '일반 스크롤: 같은 속도로 올라간다');
  assert.equal(at(600, 100, 500), 100, '상단 바 아래에서 멈춤');
  assert.equal(at(600, 100, 900), 100, '그 이후에도 고정');
  const t = ms.stickyTranslateInterpolation(80, 100);
  assert.ok(t.inputRange.every((v, i, a) => i === 0 || v > a[i - 1]), '입력 구간은 항상 증가');
});
