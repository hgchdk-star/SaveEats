/**
 * 단독 옵션(isExclusive): 백소정 키소카레 '선택안함' — 서정 제품 결정(2026-11-19). 쿠팡이츠에서 확인한 동작이 아니다.
 * 그룹은 계속 다중 선택이며(일반 토핑 여러 종류, 수량 합계 8), 이름이 아니라 isExclusive 필드로만 판단한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('../order/harness.cjs');
const sel = require('../../src/features/menu/menu-selection.ts');
const { createCatalogCartValidator } = require('../../src/services/cart/validate-cart.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');
const { hasRequiredOptions, quickAddMenu } = require('../../src/features/cart/quick-add.ts');

const M = '00000000-0000-4000-8000-0000000000e1';
const NONE = '00000000-0000-4000-8000-0000000000f1';
const PA = '00000000-0000-4000-8000-0000000000f2';
const GARLIC = '00000000-0000-4000-8000-0000000000f3';
const CHEESE = '00000000-0000-4000-8000-0000000000f4';
const qty = (id, name, price) => ({ id, name, additionalPrice: price, isSoldOut: false, allowQuantity: true, maxQuantity: 8, isExclusive: false });
const menu = (exclusive = true) => ({
  id: M, storeId: 'store-1', storeIsOpen: true, name: '키소카레', description: null, imageRef: null, price: 9900, catalogRevision: 1, isSoldOut: false,
  optionGroups: [{
    id: 'g-top', name: '키소카레 전용 옵션 (최소 1개 ~ 8개)', minSelect: 1, maxSelect: 8, maxTotalQuantity: 8,
    options: [
      { id: NONE, name: '선택안함', additionalPrice: 0, isSoldOut: false, allowQuantity: false, maxQuantity: null, isExclusive: exclusive },
      qty(PA, '대파', 0), qty(GARLIC, '마늘양파후레이크', 700), qty(CHEESE, '눈꽃치즈', 1000),
    ],
  }],
});
const g = (m) => m.optionGroups[0];

test('선택안함만 선택하면 필수 조건을 충족하고, 아무것도 안 고르면 필수에 걸린다', () => {
  const m = menu();
  assert.ok(sel.firstMissingRequired(m, {}) !== null);
  const s = sel.toggleOption({}, g(m), NONE);
  assert.deepEqual(s['g-top'], [NONE]);
  assert.equal(sel.firstMissingRequired(m, s), null);
  assert.equal(sel.unitPrice(m, s, {}), 9900);
  assert.equal(sel.allowsQuantity(g(m).options[0]), false, '단독 옵션은 수량 조절이 없다');
});

test('선택안함을 고르면 다른 토핑이 해제되고, 토핑을 고르면 선택안함이 해제된다', () => {
  const m = menu();
  let s = sel.toggleOption(sel.toggleOption({}, g(m), PA), g(m), GARLIC);
  s = sel.toggleOption(s, g(m), NONE);
  assert.deepEqual(s['g-top'], [NONE]);
  s = sel.toggleOption(s, g(m), CHEESE);
  assert.deepEqual(s['g-top'], [CHEESE]);
  s = sel.toggleOption(s, g(m), GARLIC);
  assert.deepEqual(s['g-top'], [CHEESE, GARLIC], '일반 토핑은 여러 종류를 고를 수 있다');
  // 같은 선택안함을 다시 누르면 해제(필수라 다시 걸린다)
  const off = sel.toggleOption(sel.toggleOption({}, g(m), NONE), g(m), NONE);
  assert.deepEqual(off['g-top'], []);
  assert.ok(sel.firstMissingRequired(m, off) !== null);
});

test('단독 옵션으로 전환하면 이전 토핑의 수량 상태도 정리된다', () => {
  const m = menu();
  let s = sel.toggleOption(sel.toggleOption({}, g(m), PA), g(m), GARLIC);
  let q = sel.setOptionQuantity(m, s, {}, PA, 5);
  q = sel.setOptionQuantity(m, s, q, GARLIC, 3);
  assert.equal(sel.groupTotalQuantity(g(m), s, q), 8);
  s = sel.toggleOption(s, g(m), NONE, q);
  q = sel.pruneQuantities(m, s, q);
  assert.deepEqual(q, {}, '선택에서 빠진 토핑의 수량은 지워진다');
  assert.equal(sel.unitPrice(m, s, sel.selectedOptionQuantities(m, s, q)), 9900);
  // 다시 토핑을 고르면 1개부터 시작한다
  s = sel.toggleOption(s, g(m), PA, q);
  assert.equal(sel.quantityOf(sel.setOptionQuantity(m, s, q, PA, 1), PA), 1);
});

test('일반 토핑: 여러 종류 합계 8까지 허용, 9는 막힌다(선택안함의 수량 1은 합계 계산에 영향 없음)', () => {
  const m = menu();
  let s = sel.toggleOption(sel.toggleOption({}, g(m), GARLIC), g(m), CHEESE);
  let q = sel.setOptionQuantity(m, s, {}, GARLIC, 3);
  q = sel.setOptionQuantity(m, s, q, CHEESE, 8);
  assert.equal(sel.groupTotalQuantity(g(m), s, q), 8);
  assert.equal(sel.quantityOf(q, CHEESE), 5, '합계 8 안에서 남은 몫(5)까지만');
  assert.deepEqual(sel.toggleOption(s, g(m), PA, q)['g-top'], [GARLIC, CHEESE], '합계가 차면 다른 토핑을 더 고를 수 없다');
  // 단독 옵션은 합계가 가득 차 있어도 고를 수 있다(다른 선택을 해제하므로)
  assert.deepEqual(sel.toggleOption(s, g(m), NONE, q)['g-top'], [NONE]);
  assert.equal(sel.unitPrice(m, s, sel.selectedOptionQuantities(m, s, q)), 9900 + 700 * 3 + 1000 * 5);
});

test('이름이 같아도 isExclusive가 없거나 false면 단독이 아니다(구형 응답·다른 가게 호환)', () => {
  const m = menu(false);
  let s = sel.toggleOption({}, g(m), NONE);
  s = sel.toggleOption(s, g(m), PA);
  assert.deepEqual(s['g-top'], [NONE, PA], '단독 표시가 없으면 함께 고를 수 있다');
  const raw = JSON.parse(JSON.stringify(menu())); for (const o of raw.optionGroups[0].options) delete o.isExclusive;
  const parsed = parseMenuDetail(raw);
  assert.equal(sel.isExclusiveOption(parsed.optionGroups[0].options[0]), false);
  assert.deepEqual(sel.toggleOption(sel.toggleOption({}, parsed.optionGroups[0], NONE), parsed.optionGroups[0], PA)['g-top'], [NONE, PA]);
});

test('서버 응답 파싱: isExclusive는 boolean 또는 없음, 그 밖은 거절', () => {
  const raw = (v) => { const m = menu(); if (v === undefined) delete m.optionGroups[0].options[0].isExclusive; else m.optionGroups[0].options[0].isExclusive = v; return m; };
  assert.equal(parseMenuDetail(raw(true)).optionGroups[0].options[0].isExclusive, true);
  assert.equal(parseMenuDetail(raw(false)).optionGroups[0].options[0].isExclusive, false);
  assert.equal(parseMenuDetail(raw(undefined)).optionGroups[0].options[0].isExclusive, undefined);
  for (const bad of ['true', 1, null]) assert.throws(() => parseMenuDetail(raw(bad)), Error, String(bad));
});

test('필수 옵션이 있는 메뉴라 목록에서 바로 담지 않고 상세로 보낸다', async () => {
  assert.equal(hasRequiredOptions(menu()), true);
  let added = null;
  const out = await quickAddMenu(M, { getMenu: async () => menu(), add: async (i) => { added = i; return { ok: true }; }, preparingStoreOrderable: true });
  assert.equal(out.kind, 'NEEDS_DETAIL'); assert.equal(added, null);
});

test('장바구니 확인: 선택안함만·토핑만은 통과, 선택안함+토핑 같은 오래된 조합은 OPTIONS_INVALID(몰래 고치지 않음)', async () => {
  const v = createCatalogCartValidator({ getMenu: async () => menu() });
  const input = (opts, quantities, price) => ({ storeId: 'store-1', items: [{ clientItemId: 'c1', menuId: M, optionIds: opts, optionQuantities: quantities, acknowledgedUnitPrice: price }] });
  assert.equal((await v(input([NONE], undefined, 9900))).items.c1.status, 'VALID');
  assert.equal((await v(input([GARLIC, CHEESE], { [GARLIC]: 3, [CHEESE]: 5 }, 9900 + 2100 + 5000))).items.c1.status, 'VALID');
  assert.equal((await v(input([NONE, PA], undefined, 9900))).items.c1.status, 'OPTIONS_INVALID');
  assert.equal((await v(input([GARLIC, NONE, CHEESE], undefined, 11600))).items.c1.status, 'OPTIONS_INVALID', '순서와 상관없이 차단');
  assert.equal((await v(input([NONE], { [NONE]: 2 }, 9900))).items.c1.status, 'OPTIONS_INVALID', '단독 옵션 수량 2는 차단');
  assert.equal((await v(input([GARLIC, CHEESE], { [GARLIC]: 4, [CHEESE]: 5 }, 9900 + 2800 + 5000))).items.c1.status, 'OPTIONS_INVALID', '합계 9는 차단');
  // 구형 정상 요청(isExclusive 없는 응답·다른 가게 메뉴)은 영향이 없다
  const old = createCatalogCartValidator({ getMenu: async () => menu(false) });
  assert.equal((await old(input([NONE, PA], undefined, 9900))).items.c1.status, 'VALID');
});
