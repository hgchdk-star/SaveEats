/**
 * 옵션 그룹 수량 합계 제한(maxTotalQuantity): 도미노 '음료 (최대 2개 가능)' — 서정 제품 결정(2026-11-19).
 * 종류 수 제한(maxSelect)과 별개이며, 제한이 없는 그룹(null/없음)의 동작은 그대로여야 한다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
require('../order/harness.cjs'); // TS 변환 준비
const sel = require('../../src/features/menu/menu-selection.ts');
const { createCatalogCartValidator } = require('../../src/services/cart/validate-cart.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');

const M = '00000000-0000-4000-8000-0000000000c1';
const COLA = '00000000-0000-4000-8000-0000000000d1';
const CIDER = '00000000-0000-4000-8000-0000000000d2';
const ZERO = '00000000-0000-4000-8000-0000000000d3';
const TENDER = '00000000-0000-4000-8000-0000000000d4';

const drinkOpt = (id, name) => ({ id, name, additionalPrice: 1800, isSoldOut: false, allowQuantity: true, maxQuantity: 2 });
const menu = (total = 2) => ({
  id: M, storeId: 'store-1', storeIsOpen: true, name: '피자', description: null, imageRef: null, price: 30000, catalogRevision: 1, isSoldOut: false,
  optionGroups: [
    { id: 'g-drink', name: '음료 (최대 2개 가능)', minSelect: 0, maxSelect: 2, maxTotalQuantity: total, options: [drinkOpt(COLA, '콜라'), drinkOpt(CIDER, '사이다'), drinkOpt(ZERO, '제로')] },
    { id: 'g-side', name: '사이드', minSelect: 0, maxSelect: 1000, maxTotalQuantity: null, options: [{ id: TENDER, name: '치킨텐더', additionalPrice: 7900, isSoldOut: false, allowQuantity: true, maxQuantity: 10 }] },
  ],
});
const group = (m, id) => m.optionGroups.find((g) => g.id === id);

test('같은 음료 2개: 가능', () => {
  const m = menu();
  let s = sel.toggleOption({}, group(m, 'g-drink'), COLA);
  const q = sel.setOptionQuantity(m, s, {}, COLA, 2);
  assert.equal(sel.quantityOf(q, COLA), 2);
  assert.equal(sel.unitPrice(m, s, q), 30000 + 1800 * 2);
});

test('서로 다른 음료 1개씩: 가능, 그다음엔 수량을 더 올릴 수 없다', () => {
  const m = menu(); const g = group(m, 'g-drink');
  let s = sel.toggleOption({}, g, COLA);
  s = sel.toggleOption(s, g, CIDER);
  assert.deepEqual(s['g-drink'], [COLA, CIDER]);
  let q = {};
  q = sel.setOptionQuantity(m, s, q, COLA, 2); // 사이다 1개가 이미 있어 합계 2를 넘는다 → 1로 남는다
  assert.equal(sel.quantityOf(q, COLA), 1);
  assert.equal(sel.effectiveMaxQuantity(g, g.options[0], s, q), 1);
});

test('음료 합계 3개 이상은 앱에서 만들 수 없다', () => {
  const m = menu(); const g = group(m, 'g-drink');
  // 콜라 2개를 고른 뒤 사이다를 더 고를 수 없다
  let s = sel.toggleOption({}, g, COLA);
  let q = sel.setOptionQuantity(m, s, {}, COLA, 2);
  const s2 = sel.toggleOption(s, g, CIDER, q);
  assert.deepEqual(s2['g-drink'], [COLA]);
  // 콜라 1 + 사이다 1에서 콜라를 3으로 요청해도 합계 2로 잘린다
  s = sel.toggleOption(sel.toggleOption({}, g, COLA), g, CIDER);
  q = sel.setOptionQuantity(m, s, {}, COLA, 3);
  assert.equal(sel.groupTotalQuantity(g, s, q), 2);
  // 사이다 2개 → 콜라 추가 불가, 콜라를 내려도 다른 쪽이 늘 수 있다
  s = sel.toggleOption({}, g, CIDER);
  q = sel.setOptionQuantity(m, s, {}, CIDER, 2);
  assert.equal(sel.effectiveMaxQuantity(g, g.options[1], s, q), 2);
});

test('prune: 합계가 상한을 넘는 수량(옛 데이터)은 뒤쪽부터 줄인다', () => {
  const m = menu(); const g = group(m, 'g-drink');
  const s = { 'g-drink': [COLA, CIDER] };
  const q = sel.pruneQuantities(m, s, { [COLA]: 2, [CIDER]: 2 });
  assert.equal(sel.groupTotalQuantity(g, s, q), 2);
  assert.equal(sel.quantityOf(q, COLA), 1); // 합계 4 → 2: 뒤쪽(사이다)부터 1까지, 그래도 넘으면 앞쪽도 줄인다
  assert.equal(sel.quantityOf(q, CIDER), 1);
  const q3 = sel.pruneQuantities(m, { 'g-drink': [COLA] }, { [COLA]: 2 });
  assert.equal(sel.quantityOf(q3, COLA), 2); // 한 종류 2개는 그대로
});

test('종류 수 제한(maxSelect)은 그대로: 3종은 합계와 상관없이 막힌다', () => {
  const m = menu(5); const g = group(m, 'g-drink'); // 합계 5라도 종류는 2까지
  let s = sel.toggleOption({}, g, COLA); s = sel.toggleOption(s, g, CIDER); s = sel.toggleOption(s, g, ZERO);
  assert.deepEqual(s['g-drink'], [COLA, CIDER]);
});

test('합계 제한이 없는 그룹은 기존 동작: 옵션 상한까지, 다른 그룹과 합계가 섞이지 않는다', () => {
  const m = menu(); const side = group(m, 'g-side');
  assert.equal(sel.totalLimitOf(side), null);
  let s = sel.toggleOption({}, side, TENDER);
  const q = sel.setOptionQuantity(m, s, {}, TENDER, 10);
  assert.equal(sel.quantityOf(q, TENDER), 10);
  s = sel.toggleOption(s, group(m, 'g-drink'), COLA);
  assert.equal(sel.quantityOf(sel.setOptionQuantity(m, s, q, COLA, 2), COLA), 2);
  // 합계 제한이 아예 없는(키가 없는) 구형 메뉴도 그대로
  const old = menu(); delete old.optionGroups[0].maxTotalQuantity;
  assert.equal(sel.totalLimitOf(old.optionGroups[0]), null);
});

test('단가 × 옵션 수량 × 메뉴 수량', () => {
  const m = menu(); const g = group(m, 'g-drink');
  let s = sel.toggleOption(sel.toggleOption({}, group(m, 'g-side'), TENDER), g, COLA);
  let q = sel.setOptionQuantity(m, s, {}, TENDER, 3);
  q = sel.setOptionQuantity(m, s, q, COLA, 2);
  const unit = sel.unitPrice(m, s, sel.selectedOptionQuantities(m, s, q));
  assert.equal(unit, 30000 + 7900 * 3 + 1800 * 2);
  assert.equal(unit * 2, (30000 + 23700 + 3600) * 2);
});

test('서버 응답 파싱: maxTotalQuantity 숫자·null·없음 허용, 0·소수·문자열은 거절', () => {
  const raw = (v) => { const m = menu(); if (v === undefined) delete m.optionGroups[0].maxTotalQuantity; else m.optionGroups[0].maxTotalQuantity = v; return m; };
  assert.equal(parseMenuDetail(raw(2)).optionGroups[0].maxTotalQuantity, 2);
  assert.equal(parseMenuDetail(raw(null)).optionGroups[0].maxTotalQuantity, null);
  assert.equal(parseMenuDetail(raw(undefined)).optionGroups[0].maxTotalQuantity, undefined);
  for (const bad of [0, 1.5, '2', -1]) assert.throws(() => parseMenuDetail(raw(bad)), Error, String(bad));
});

test('장바구니 확인: 합계를 넘는 담긴 항목은 OPTIONS_INVALID', async () => {
  const v = createCatalogCartValidator({ getMenu: async () => menu() });
  const input = (opts, quantities, price) => ({ storeId: 'store-1', items: [{ clientItemId: 'c1', menuId: M, optionIds: opts, optionQuantities: quantities, acknowledgedUnitPrice: price }] });
  assert.equal((await v(input([COLA], { [COLA]: 2 }, 33600))).items.c1.status, 'VALID');
  assert.equal((await v(input([COLA, CIDER], undefined, 33600))).items.c1.status, 'VALID');
  assert.equal((await v(input([COLA, CIDER], { [COLA]: 2 }, 35400))).items.c1.status, 'OPTIONS_INVALID');
  assert.equal((await v(input([COLA, CIDER], { [COLA]: 2, [CIDER]: 2 }, 37200))).items.c1.status, 'OPTIONS_INVALID');
  // 합계 제한이 없는 메뉴(null)는 같은 선택도 통과(옵션 상한 2 이내)
  const v2 = createCatalogCartValidator({ getMenu: async () => menu(null) });
  assert.equal((await v2(input([COLA, CIDER], { [COLA]: 2, [CIDER]: 2 }, 37200))).items.c1.status, 'VALID');
});
