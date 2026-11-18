/**
 * 실제 서버(개발 프로젝트) get_menu 응답을 앱 코드에 그대로 통과시키는 시험.
 * 서버 응답 → DTO 파싱 → 선택·수량 규칙 → 금액 → 장바구니 → 주문 요청까지 끊기는 곳이 없는지 본다.
 * 픽스처는 2026-11-18에 공개 키(Guest)로 받은 "(New) 서울엄마 파기름떡볶이 치킨" 응답이다(공개 카탈로그 데이터).
 * 수량 허용 옵션은 서정이 쿠팡이츠 화면에서 확인한 소스 10종뿐이다. 이름·그룹 소속만으로 늘리지 않는다.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createWorld } = require('../order/harness.cjs');
const sel = require('../../src/features/menu/menu-selection.ts');
const cartModel = require('../../src/features/cart/cart-model.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'get-menu-real-pateokchi.json'), 'utf8'));
const menu = parseMenuDetail(raw);

// 서정 확정(2026-11-18): '소스&치킨무&피클 추가선택' 그룹에서 수량 조절이 확인된 소스 10종
const CONFIRMED_SAUCES = ['갈릭디핑 소스', '핫소스', '파.떡.치 소스', '매콤소스', '달콤소스', '마블링소스', '고블링소스', '요블링소스', '마그마소스', '왕중왕소스'];
const NOT_CONFIRMED = ['치킨무', '피클', '추블링 살사', '치트킹 (콘스프맛)'];
const sauceGroup = menu.optionGroups.find((g) => g.name.includes('소스&치킨무&피클'));
const byName = (name) => sauceGroup.options.find((o) => o.name === name);

/** 필수 그룹마다 첫 번째 선택지를 고른 선택(실제 앱에서 사용자가 필수를 채운 상태) */
function requiredPicked() {
  const picked = {};
  for (const g of menu.optionGroups) if (sel.isRequired(g)) picked[g.id] = [g.options.find((o) => !o.isSoldOut).id];
  return picked;
}

test('실제 응답이 앱 DTO로 파싱되고 소스 그룹의 모양이 서버와 같다', () => {
  assert.equal(menu.name, '(New) 서울엄마 파기름떡볶이 치킨');
  assert.equal(menu.price, 25000);
  assert.ok(sauceGroup, '소스&치킨무&피클 그룹이 있다');
  assert.equal(sauceGroup.minSelect, 0);
  assert.equal(sauceGroup.maxSelect, 1000); // 원본 값 그대로(DB를 바꾸지 않았다)
  assert.equal(sauceGroup.options.length, 14);
});

test('수량 조절은 확인된 소스 10종에만 켜지고 상한은 10이다', () => {
  for (const name of CONFIRMED_SAUCES) {
    const o = byName(name);
    assert.ok(o, name);
    assert.equal(sel.allowsQuantity(o), true, `${name} 수량 허용`);
    assert.equal(o.maxQuantity, 10, `${name} 상한 10`);
  }
  for (const name of NOT_CONFIRMED) {
    assert.equal(sel.allowsQuantity(byName(name)), false, `${name}은 확인 전이라 수량 조절 없음`);
  }
  // 다른 그룹(음료·사이드·'최대 2개 가능' 등)의 옵션에는 수량 조절이 하나도 없다
  const others = menu.optionGroups.filter((g) => g !== sauceGroup).flatMap((g) => g.options);
  assert.equal(others.some((o) => sel.allowsQuantity(o)), false);
});

test('파.떡.치 소스 700원 × 2개 = 추가금 1,400원, 메뉴 2개와는 별도로 계산한다', () => {
  const sauce = byName('파.떡.치 소스');
  const selection = { ...requiredPicked(), [sauceGroup.id]: [sauce.id] };
  const q = sel.setOptionQuantity(menu, selection, {}, sauce.id, 2);
  assert.deepEqual(q, { [sauce.id]: 2 });
  const unit = sel.unitPrice(menu, selection, q);
  assert.equal(unit, 25000 + 700 * 2); // 필수 옵션은 0원이라 중복 합산이 없다
  assert.equal(unit * 2, 52800); // (기본 + Σ 옵션 추가금×옵션 수량) × 메뉴 수량
});

test('상한(10)을 넘기는 요청은 10으로 맞추고, 확인 전 옵션의 수량은 바뀌지 않는다', () => {
  const sauce = byName('파.떡.치 소스');
  const selection = { ...requiredPicked(), [sauceGroup.id]: [sauce.id, byName('치킨무').id] };
  let q = sel.setOptionQuantity(menu, selection, {}, sauce.id, 99);
  assert.equal(q[sauce.id], 10);
  const before = q;
  q = sel.setOptionQuantity(menu, selection, q, byName('치킨무').id, 3);
  assert.deepEqual(q, before, '치킨무는 수량 조절이 없으므로 그대로');
});

test('옵션 수량이 다르면 장바구니에서 다른 줄이고, 같은 구성은 합쳐진다', () => {
  const sauce = byName('파.떡.치 소스');
  const selection = { ...requiredPicked(), [sauceGroup.id]: [sauce.id] };
  const ids = sel.selectedOptionIds(menu, selection);
  const base = (qty, uq) => ({
    storeId: menu.storeId, menuId: menu.id, optionIds: ids, optionQuantities: qty ? { [sauce.id]: qty } : undefined,
    quantity: 1, unitPrice: uq, catalogRevision: menu.catalogRevision, menuName: menu.name,
    optionNames: sel.selectedOptionNames(menu, selection, qty ? { [sauce.id]: qty } : {}), imageRef: menu.imageRef,
  });
  let cart = cartModel.createEmptyCart();
  cart = cartModel.addToCart(cart, base(2, 26400)).cart;
  cart = cartModel.addToCart(cart, base(3, 27100)).cart;
  assert.equal(cart.items.length, 2);
  cart = cartModel.addToCart(cart, base(2, 26400)).cart;
  assert.equal(cart.items.length, 2);
  assert.equal(cart.items.find((i) => i.optionQuantities?.[sauce.id] === 2).quantity, 2);
  assert.ok(cart.items.some((i) => i.optionNames.some((n) => n.includes('×3'))), '옵션 이름에 수량 표시');
});

test('주문 요청은 옵션 수량이 있으면 v3, 없으면 v2로 보낸다', () => {
  const w = createWorld();
  const sauce = byName('파.떡.치 소스');
  const selection = { ...requiredPicked(), [sauceGroup.id]: [sauce.id] };
  const ids = sel.selectedOptionIds(menu, selection);
  const item = (qty) => ({
    clientItemId: 'c1', menuId: menu.id, optionIds: ids, optionQuantities: qty ? { [sauce.id]: qty } : undefined, quantity: 2,
    acknowledgedUnitPrice: qty ? 26400 : 25000, acknowledgedCatalogRevision: menu.catalogRevision, menuName: menu.name, optionNames: [], imageRef: null,
  });
  const cart = (qty) => ({ ...cartModel.createEmptyCart(), storeId: menu.storeId, items: [item(qty)] });
  const account = { id: 'dest-ref', revision: 1, bankCode: 'TOSS', bankName: '토스뱅크', last4: '3456' };
  const v3 = w.actions.buildCreateOrderRequest(cart(2), account);
  assert.equal(v3.requestVersion, 3);
  const line = v3.items[0];
  assert.equal(line.quantity, 2);
  assert.equal(line.options.find((o) => o.optionId === sauce.id).quantity, 2);
  assert.equal(line.optionIds, undefined);
  assert.equal(v3.approvedTotalAmount, 52800);
  const v2 = w.actions.buildCreateOrderRequest(cart(undefined), account);
  assert.equal(v2.requestVersion, 2);
  assert.deepEqual(v2.items[0].optionIds, ids);
});
