/**
 * 2026-11-21 쿠팡이츠 수집본 8개 가게(BHC·맘스터치·메가MGC커피·미소야·본죽&비빔밥·신전떡볶이·짬뽕지존·피자스쿨)의 반영 후 메뉴 구조를 앱 코드에 통과시키는 시험.
 * 픽스처는 서버 적용 전 로컬 에뮬레이션(임시 Postgres에 저장소 migration + 적용 도구 실행 + Guest(anon) 역할 get_store·get_menu 응답)이다.
 * 개발 서버에 적용한 뒤에는 실제 Guest 응답으로 교체한다. 공개 카탈로그 데이터이며 비밀값은 없다.
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

const dir = path.join(__dirname, 'fixtures', 'catalog-emulated');
const load = (k) => ({
  menus: JSON.parse(fs.readFileSync(path.join(dir, `${k}-menus.json`), 'utf8')).map(parseMenuDetail),
  store: JSON.parse(fs.readFileSync(path.join(dir, `${k}-store.json`), 'utf8')),
});
// 보이는 메뉴 수, 메뉴 그룹 수(숨김 메뉴만 있는 그룹은 응답에서 빠짐), 필수 선택 메뉴 수, 수량 조절 선택지 수, 품절 선택지 수(보이는 메뉴 기준)
const EXPECT = {
  bhc: [155, 18, 107, 0, 0], momstouch: [80, 10, 44, 0, 228], megamgc: [143, 11, 15, 0, 0], misoya: [71, 8, 0, 0, 0],
  bonjuk: [47, 10, 40, 0, 657], sinjeon: [50, 4, 12, 0, 0], jjambbongjizon: [43, 4, 28, 489, 0], pizzaschool: [60, 7, 29, 288, 0],
};

for (const [k, [nMenus, nGroups]] of Object.entries(EXPECT)) {
  test(`${k}: 보이는 메뉴·그룹 수와 섹션, 검색 결과는 한 번만`, () => {
    const { store } = load(k);
    assert.equal(store.menus.length, nMenus);
    assert.equal(store.menuGroups.length, nGroups);
    const r = ms.buildMenuSections(store.menus, store.menuGroups, '기타 메뉴');
    assert.equal(r.sections.length, nGroups);
    assert.equal(new Set(r.sections.flatMap((s) => s.menus.map((m) => m.id))).size, nMenus);
    const hits = ms.searchMenus(store.menus, r.sections, store.menus[0].name.slice(0, 2));
    assert.equal(new Set(hits.map((m) => m.id)).size, hits.length);
  });
}

for (const [k, [nMenus, , nReq, nQty, nSold]] of Object.entries(EXPECT)) {
  test(`${k}: 필수 선택 ${nReq}개 메뉴는 상세로, 나머지는 옵션 없이 1개 바로 담기, 수량·품절 필드`, async () => {
    const { menus } = load(k);
    assert.equal(menus.length, nMenus);
    assert.equal(menus.filter(hasRequiredOptions).length, nReq);
    for (const m of menus) {
      let added = null;
      const out = await quickAddMenu(m.id, { getMenu: async () => m, add: async (i) => { added = i; return { ok: true }; }, preparingStoreOrderable: true });
      if (hasRequiredOptions(m)) { assert.equal(out.kind, 'NEEDS_DETAIL'); assert.equal(added, null); }
      else { assert.equal(out.kind, 'ADDED', m.name); assert.equal(added.quantity, 1); assert.deepEqual(added.optionIds, []); assert.equal(added.unitPrice, m.price); }
    }
    const opts = menus.flatMap((m) => m.optionGroups.flatMap((g) => g.options));
    assert.equal(opts.filter(sel.allowsQuantity).length, nQty);
    assert.equal(opts.filter((o) => o.isSoldOut).length, nSold);
    assert.ok(opts.filter(sel.allowsQuantity).every((o) => o.maxQuantity <= 10), '원본 1000이 아니라 앱 상한 10');
  });
}

test('피자스쿨 토핑 추가: 한 선택지 10개 가능, 6+4 통과, 6+5는 합계 10에서 4개로 멈춤(필수 엣지 선택과 함께)', () => {
  const { menus } = load('pizzaschool');
  const m = menus.find((x) => x.name === '포테이토피자');
  const g = m.optionGroups.find((x) => x.name.startsWith('토핑 추가'));
  assert.equal(sel.totalLimitOf(g), 10); assert.equal(g.maxSelect, 10);
  const [a, b] = g.options;
  let s = sel.toggleOption({}, g, a.id), q = sel.setOptionQuantity(m, s, {}, a.id, 10);
  assert.equal(sel.quantityOf(q, a.id), 10);
  s = sel.toggleOption({}, g, a.id); q = sel.setOptionQuantity(m, s, {}, a.id, 6);
  s = sel.toggleOption(s, g, b.id, q); q = sel.setOptionQuantity(m, s, q, b.id, 4);
  assert.equal(sel.groupTotalQuantity(g, s, q), 10);
  q = sel.setOptionQuantity(m, s, q, b.id, 5);
  assert.equal(sel.quantityOf(q, b.id), 4);
  const edge = m.optionGroups.find((x) => x.name.startsWith('엣지'));
  assert.ok(sel.firstMissingRequired(m, s) !== null, '엣지 선택(필수)을 고르기 전에는 담기 불가');
  const s2 = sel.toggleOption(s, edge, edge.options[0].id);
  assert.equal(sel.firstMissingRequired(m, s2), null);
  assert.equal(sel.unitPrice(m, s2, q), m.price + edge.options[0].additionalPrice + a.additionalPrice * 6 + b.additionalPrice * 4);
});

test('짬뽕지존 수량 옵션: 그룹 합계 제한 없음, 개별 상한은 10(원본 1000 아님), 최소 0은 선택 해제', () => {
  const { menus } = load('jjambbongjizon');
  const qg = menus.flatMap((m) => m.optionGroups.filter((g) => g.options.some(sel.allowsQuantity)));
  assert.ok(qg.length > 50);
  assert.ok(qg.every((g) => sel.totalLimitOf(g) === null));
  const m = menus.find((x) => x.optionGroups.some((g) => g.options.some(sel.allowsQuantity)) && !hasRequiredOptions(x)) || menus.find((x) => x.optionGroups.some((g) => g.options.some(sel.allowsQuantity)));
  const g = m.optionGroups.find((x) => x.options.some(sel.allowsQuantity)); const o = g.options.find(sel.allowsQuantity);
  let s = sel.toggleOption({}, g, o.id), q = sel.setOptionQuantity(m, s, {}, o.id, 99);
  assert.equal(sel.quantityOf(q, o.id), 10);
  q = sel.setOptionQuantity(m, s, q, o.id, 3);
  assert.equal(sel.quantityOf(q, o.id), 3);
  assert.equal(sel.unitPrice(m, s, q), m.price + o.additionalPrice * 3);
  s = sel.toggleOption(s, g, o.id, q);   // 같은 선택지를 다시 누르면 선택 해제(수량 0에 해당)
  assert.ok(!(s[g.id] || []).includes(o.id));
});

test('맘스터치·본죽: 품절 선택지는 isSoldOut으로 내려오고, 필수 그룹에 주문 가능한 선택지가 남아 있다', () => {
  for (const k of ['momstouch', 'bonjuk']) {
    const { menus } = load(k);
    assert.ok(menus.some((m) => m.optionGroups.some((g) => g.options.some((o) => o.isSoldOut))));
    for (const m of menus) for (const g of m.optionGroups) if (g.minSelect >= 1) assert.ok(g.options.filter((o) => !o.isSoldOut).length >= g.minSelect, `${m.name}/${g.name}`);
  }
});
