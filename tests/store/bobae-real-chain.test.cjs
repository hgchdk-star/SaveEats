/**
 * 실제 서버(개발 프로젝트) Guest 응답을 앱 코드에 그대로 통과시키는 시험: 보배반점(응암점 수집본 반영 후).
 * 픽스처는 2026-11-19에 공개 키(Guest)로 받은 get_store·get_menu 응답이다(공개 카탈로그 데이터, 비밀값 없음).
 * 앱에 보이는 메뉴 62개·그룹 8개(리뷰이벤트·주류 19개는 숨김), 필수 옵션 44개 메뉴는 상세로·나머지 18개는 바로 담기.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../order/harness.cjs'); // TS 변환 준비
const sel = require('../../src/features/menu/menu-selection.ts');
const ms = require('../../src/features/store/menu-sections.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');
const { hasRequiredOptions, quickAddMenu } = require('../../src/features/cart/quick-add.ts');
const { createCatalogCartValidator } = require('../../src/services/cart/validate-cart.ts');

const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bobae-real-guest-menus.json'), 'utf8')).map(parseMenuDetail);
const store = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'bobae-real-guest-store.json'), 'utf8'));

test('보이는 메뉴 62개가 앱 DTO로 파싱되고 숨긴 리뷰이벤트·주류는 응답에 없다', () => {
  assert.equal(dump.length, 62);
  const names = new Set(dump.map((m) => m.name));
  for (const hidden of ['포토 리뷰 이벤트 참여', '카스', '테라', '참이슬 후레쉬 360ml']) assert.ok(!names.has(hidden), hidden);
  assert.deepEqual(store.menuGroups.map((g) => g.name), ['1인 세트메뉴', '2인 세트메뉴', '안주세트', '식사류(면)', '식사류(밥)', '요리류', '사이드', '음료']);
});

test('필수 옵션 44개 메뉴는 상세로(담기 호출 0회), 나머지 18개는 옵션 없이 1개 바로 담기', async () => {
  assert.equal(dump.filter(hasRequiredOptions).length, 44);
  for (const m of dump) {
    let added = null;
    const out = await quickAddMenu(m.id, { getMenu: async () => m, add: async (i) => { added = i; return { ok: true }; }, preparingStoreOrderable: true });
    if (hasRequiredOptions(m)) { assert.equal(out.kind, 'NEEDS_DETAIL'); assert.equal(added, null); }
    else { assert.equal(out.kind, 'ADDED'); assert.equal(added.quantity, 1); assert.deepEqual(added.optionIds, []); assert.equal(added.unitPrice, m.price); }
  }
});

test('수량 조절기·단독 옵션·합계 제한이 하나도 없다(원본 수량 변경 플래그 0개)', () => {
  for (const m of dump) for (const g of m.optionGroups) { assert.equal(sel.totalLimitOf(g), null); for (const o of g.options) { assert.equal(sel.allowsQuantity(o), false); assert.equal(sel.isExclusiveOption(o), false); } }
});

test('섹션 8개·소속 62개, 검색 결과는 한 번만', () => {
  const r = ms.buildMenuSections(store.menus, store.menuGroups, '기타 메뉴');
  assert.equal(r.sections.length, 8);
  assert.equal(r.sections.reduce((n, s) => n + s.menus.length, 0), 62);
  const hits = ms.searchMenus(store.menus, r.sections, '짬뽕');
  assert.equal(new Set(hits.map((m) => m.id)).size, hits.length);
  assert.ok(hits.some((m) => m.name === '보배짬뽕'));
});

test('1인 세트: 필수 미선택이면 담기 불가(자동 선택 없음), 선택 후 금액 = 기본가 + 선택 추가금, 장바구니 필수 누락 차단', async () => {
  const m = dump.find((x) => x.name === '짜장+탕수육(미니)'); const [a, b] = m.optionGroups;
  assert.ok(sel.firstMissingRequired(m, {}) !== null);
  let s = sel.toggleOption({}, a, a.options[0].id);
  assert.ok(sel.firstMissingRequired(m, s) !== null);
  const last = b.options[b.options.length - 1];
  s = sel.toggleOption(s, b, last.id);
  assert.equal(sel.firstMissingRequired(m, s), null);
  assert.equal(sel.unitPrice(m, s, {}), m.price + a.options[0].additionalPrice + last.additionalPrice);
  const v = createCatalogCartValidator({ getMenu: async () => m });
  const mk = (ids, price) => ({ storeId: m.storeId, items: [{ clientItemId: 'c', menuId: m.id, optionIds: ids, acknowledgedUnitPrice: price }] });
  assert.equal((await v(mk([], m.price))).items.c.status, 'OPTIONS_INVALID');
  assert.equal((await v(mk([a.options[0].id, last.id], m.price + a.options[0].additionalPrice + last.additionalPrice))).items.c.status, 'VALID');
});

test('연결 메뉴 가격·이름: 소고기짬뽕 14,000·크림짬뽕 15,000·보배 짜장면 8,500', () => {
  const by = Object.fromEntries(dump.map((m) => [m.name, m]));
  assert.equal(by['소고기짬뽕'].price, 14000); assert.equal(by['크림짬뽕'].price, 15000); assert.equal(by['보배 짜장면'].price, 8500); assert.equal(by['보배짬뽕'].price, 10500);
});
