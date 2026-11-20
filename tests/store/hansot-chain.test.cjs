/**
 * 한솥도시락(명지대점 수집본 반영 후) 메뉴 구조를 앱 코드에 통과시키는 시험.
 * 픽스처는 2026-11-20 개발 서버 적용 뒤 공개 키(Guest)로 받은 실제 get_store·get_menu 응답이다(공개 카탈로그 데이터, 비밀값 없음).
 * 메뉴 111개·그룹 20개, 필수 옵션 그룹 0개 → 111개 모두 바로 담기, 선택 옵션(수량 조절 288개)은 상세에서 추가.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../order/harness.cjs');
const sel = require('../../src/features/menu/menu-selection.ts');
const ms = require('../../src/features/store/menu-sections.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');
const { hasRequiredOptions, quickAddMenu } = require('../../src/features/cart/quick-add.ts');
const { createCatalogCartValidator } = require('../../src/services/cart/validate-cart.ts');

const dump = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hansot-real-guest-menus.json'), 'utf8')).map(parseMenuDetail);
const store = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hansot-real-guest-store.json'), 'utf8'));
const by = Object.fromEntries(dump.map((m) => [m.name, m]));

test('메뉴 111개·그룹 20개(원본 이름·순서)와 연결 메뉴 가격·이름', () => {
  assert.equal(dump.length, 111);
  assert.equal(store.menuGroups.length, 20);
  assert.deepEqual(store.menuGroups.slice(0, 3).map((g) => [g.name, g.menuIds.length]), [['신메뉴', 11], ['스페셜', 3], ['프리미엄', 2]]);
  assert.equal(by['치킨마요'].price, 5100); assert.equal(by['치킨제육'].price, 6700);
  assert.equal(by['(BEST)돈까스도련님'].price, 6400); assert.equal(by['(BEST)돈까스도련님 고기고기'].price, 8500);
});

test('필수 옵션 그룹이 없어 111개 메뉴 모두 옵션 없이 1개 바로 담기', async () => {
  assert.equal(dump.filter(hasRequiredOptions).length, 0);
  for (const m of dump) {
    let added = null;
    const out = await quickAddMenu(m.id, { getMenu: async () => m, add: async (i) => { added = i; return { ok: true }; }, preparingStoreOrderable: true });
    assert.equal(out.kind, 'ADDED', m.name);
    assert.equal(added.quantity, 1); assert.deepEqual(added.optionIds, []); assert.equal(added.unitPrice, m.price);
  }
});

test('수량 조절 선택지 288개(상한 10), 합계 10 그룹 144개, 밥추가 1종 그룹은 수량 없음', () => {
  const opts = dump.flatMap((m) => m.optionGroups.flatMap((g) => g.options));
  assert.equal(opts.filter(sel.allowsQuantity).length, 288);
  assert.ok(opts.filter(sel.allowsQuantity).every((o) => o.maxQuantity === 10));
  const qg = dump.flatMap((m) => m.optionGroups.filter((g) => sel.totalLimitOf(g) !== null));
  assert.equal(qg.length, 144); assert.ok(qg.every((g) => sel.totalLimitOf(g) === 10 && g.maxSelect === 10));
  const rice = dump.flatMap((m) => m.optionGroups.filter((g) => g.name.startsWith('밥추가선택')));
  assert.equal(rice.length, 46); assert.ok(rice.every((g) => g.maxSelect === 1 && g.minSelect === 0 && g.options.every((o) => !sel.allowsQuantity(o))));
});

test('상세에서 선택 옵션 추가: 계란후라이 수량·합계 10 제한·가격, 서버 검증 대역도 통과', async () => {
  const m = dump.find((x) => x.optionGroups.some((g) => g.name.startsWith('계란후라이')) && x.optionGroups.every((g) => g.minSelect === 0));
  const g = m.optionGroups.find((x) => x.name.startsWith('계란후라이'));
  const o = g.options[0];
  let s = sel.toggleOption({}, g, o.id);
  let q = sel.setOptionQuantity(m, s, {}, o.id, 4);
  assert.equal(sel.quantityOf(q, o.id), 4);
  assert.equal(sel.unitPrice(m, s, q), m.price + o.additionalPrice * 4);
  q = sel.setOptionQuantity(m, s, q, o.id, 99);
  assert.equal(sel.quantityOf(q, o.id), 10, '원본 maxQuantity 1000이 아니라 10에서 멈춘다');
  const o2 = g.options[1]; s = sel.toggleOption(s, g, o2.id, q);
  assert.ok(sel.groupTotalQuantity(g, s, q) <= 10);
  assert.equal(sel.firstMissingRequired(m, {}), null, '필수가 없으니 아무것도 안 골라도 담기 가능');
  const v = createCatalogCartValidator({ getMenu: async () => m });
  const res = await v({ storeId: m.storeId, items: [{ clientItemId: 'c', menuId: m.id, optionIds: [], acknowledgedUnitPrice: m.price }] });
  assert.equal(res.items.c.status, 'VALID');
});

test('실제 한솥 그룹(계란후라이·김치·찌개): 한 선택지 10개 가능, 6+4 통과·6+5는 4개에서 멈춤(합계 10)', () => {
  for (const prefix of ['계란후라이', '김치', '찌개']) {
    const m = dump.find((x) => x.optionGroups.some((g) => g.name.startsWith(prefix + ' (최대 10개')));
    const g = m.optionGroups.find((x) => x.name.startsWith(prefix + ' (최대 10개'));
    const [a, b] = g.options;
    assert.equal(g.options.length, 2); assert.equal(sel.totalLimitOf(g), 10);
    // 한 선택지만 10개
    let s = sel.toggleOption({}, g, a.id), q = sel.setOptionQuantity(m, s, {}, a.id, 10);
    assert.equal(sel.quantityOf(q, a.id), 10, prefix + ' 한 선택지 10개');
    assert.equal(sel.groupTotalQuantity(g, s, q), 10);
    // 6 + 4 통과
    s = sel.toggleOption({}, g, a.id); q = sel.setOptionQuantity(m, s, {}, a.id, 6);
    s = sel.toggleOption(s, g, b.id, q); q = sel.setOptionQuantity(m, s, q, b.id, 4);
    assert.equal(sel.quantityOf(q, a.id), 6); assert.equal(sel.quantityOf(q, b.id), 4); assert.equal(sel.groupTotalQuantity(g, s, q), 10);
    assert.equal(sel.unitPrice(m, s, q), m.price + a.additionalPrice * 6 + b.additionalPrice * 4);
    // 6 + 5 요청은 합계 10을 넘지 못한다(4에서 멈춤)
    q = sel.setOptionQuantity(m, s, q, b.id, 5);
    assert.equal(sel.quantityOf(q, b.id), 4, prefix + ' 6+5는 거절(4에서 멈춤)'); assert.equal(sel.groupTotalQuantity(g, s, q), 10);
  }
});

test('사진 111개가 모두 자기 메뉴 UUID 경로로 연결(연결 메뉴 4개는 새 경로)', () => {
  assert.equal(store.menus.length, 111);
  assert.ok(store.menus.every((m) => typeof m.imageRef === 'string' && m.imageRef.startsWith('menus/' + m.id)));
  assert.equal(new Set(store.menus.map((m) => m.imageRef)).size, 111);
  for (const n of ['치킨마요', '치킨제육', '(BEST)돈까스도련님', '(BEST)돈까스도련님 고기고기']) assert.match(by[n].imageRef, /^menus\/[0-9a-f-]{36}-[0-9a-f]{8}\.(jpg|png)$/);
});

test('섹션 20개·소속 111개, 검색 결과는 한 번만', () => {
  const r = ms.buildMenuSections(store.menus, store.menuGroups, '기타 메뉴');
  assert.equal(r.sections.length, 20); assert.equal(r.sections.reduce((n, x) => n + x.menus.length, 0), 111);
  const hits = ms.searchMenus(store.menus, r.sections, '도련님');
  assert.equal(new Set(hits.map((x) => x.id)).size, hits.length); assert.ok(hits.length >= 4);
});
