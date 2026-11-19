/**
 * 실제 서버(개발 프로젝트) Guest 응답을 앱 코드에 그대로 통과시키는 시험: 설빙(홍제역점 수집본 반영 후).
 * 픽스처는 2026-11-20에 공개 키(Guest)로 받은 get_store·get_menu 응답이다(공개 카탈로그 데이터, 비밀값 없음).
 * 메뉴 102개·그룹 10개, 필수 옵션 43개 메뉴는 상세로·나머지 59개는 바로 담기, '(기본제공)' 필수 그룹 29개는 원본 그대로 보인다.
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

const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sulbing-real-guest-menus.json'), 'utf8')).map(parseMenuDetail);
const store = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'sulbing-real-guest-store.json'), 'utf8'));

test('메뉴 102개·그룹 10개(원본 이름·순서)와 연결 메뉴 가격', () => {
  assert.equal(dump.length, 102);
  assert.deepEqual(store.menuGroups.map((g) => [g.name, g.menuIds.length]), [['추천메뉴', 2], ['설빙', 17], ['사이드', 14], ['간편식', 4], ['토핑추가', 34], ['커피', 9], ['음료', 7], ['차', 9], ['에이드', 4], ['기타', 2]]);
  const by = Object.fromEntries(dump.map((m) => [m.name, m]));
  assert.equal(by['인절미설빙'].price, 11400); assert.equal(by['애플망고치즈설빙'].price, 16000); assert.equal(by['순수요거블루베리설빙'].price, 16000);
});

test('필수 옵션 43개 메뉴는 상세로(담기 호출 0회), 나머지 59개는 옵션 없이 1개 바로 담기', async () => {
  assert.equal(dump.filter(hasRequiredOptions).length, 43);
  for (const m of dump) {
    let added = null;
    const out = await quickAddMenu(m.id, { getMenu: async () => m, add: async (i) => { added = i; return { ok: true }; }, preparingStoreOrderable: true });
    if (hasRequiredOptions(m)) { assert.equal(out.kind, 'NEEDS_DETAIL'); assert.equal(added, null); }
    else { assert.equal(out.kind, 'ADDED'); assert.equal(added.quantity, 1); assert.deepEqual(added.optionIds, []); assert.equal(added.unitPrice, m.price); }
  }
});

test("'(기본제공)' 필수 그룹 29개가 원본 그대로 보이고(숨김·필수 제외 없음) 자동 선택이 없다", async () => {
  const groups = dump.flatMap((m) => m.optionGroups.filter((g) => g.minSelect >= 1 && g.options.length === 1 && g.options[0].name.trim() === '(기본제공)'));
  assert.equal(groups.length, 29);
  const m = dump.find((x) => x.name === '허쉬초코크런치설빙'); const [yeon, top] = m.optionGroups;
  assert.equal(yeon.name.trim(), '연유 선택');
  assert.ok(sel.firstMissingRequired(m, {}) !== null, '고르기 전에는 담기 불가');
  let s = sel.toggleOption({}, yeon, yeon.options[0].id);
  assert.equal(sel.firstMissingRequired(m, s), null);
  s = sel.toggleOption(s, top, top.options[0].id);
  assert.equal(sel.unitPrice(m, s, {}), m.price + top.options[0].additionalPrice);
  const v = createCatalogCartValidator({ getMenu: async () => m });
  const mk = (ids, price) => ({ storeId: m.storeId, items: [{ clientItemId: 'c', menuId: m.id, optionIds: ids, acknowledgedUnitPrice: price }] });
  assert.equal((await v(mk([], m.price))).items.c.status, 'OPTIONS_INVALID');
});

test('추가토핑 최대 20종 제한 유지(선택지 35개), 수량 조절·단독·합계 제한 없음', () => {
  for (const m of dump) for (const g of m.optionGroups) { assert.equal(sel.totalLimitOf(g), null); for (const o of g.options) { assert.equal(sel.allowsQuantity(o), false); assert.equal(sel.isExclusiveOption(o), false); } }
  const m = dump.find((x) => x.name === '허쉬초코크런치설빙'); const g = m.optionGroups.find((x) => x.name.includes('추가토핑'));
  assert.equal(g.options.length, 35); assert.equal(g.maxSelect, 20); assert.equal(sel.hasRealMaxLimit(g), true);
  let s = {}; for (const o of g.options.slice(0, 21)) s = sel.toggleOption(s, g, o.id);
  assert.equal(s[g.id].length, 20);
});

test('섹션 10개·소속 102개, 검색 결과는 한 번만, 토핑추가 단품 34개는 상세 토핑과 별개', () => {
  const r = ms.buildMenuSections(store.menus, store.menuGroups, '기타 메뉴');
  assert.equal(r.sections.length, 10); assert.equal(r.sections.reduce((n, s) => n + s.menus.length, 0), 102);
  assert.equal(r.sections[0].title, '추천메뉴'); assert.equal(r.sections[4].title, '토핑추가'); assert.equal(r.sections[4].menus.length, 34);
  const hits = ms.searchMenus(store.menus, r.sections, '인절미');
  assert.equal(new Set(hits.map((m) => m.id)).size, hits.length); assert.ok(hits.length > 5);
});
