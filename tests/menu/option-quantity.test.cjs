const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorld } = require('../order/harness.cjs'); // TS 변환 준비와 주문 흐름 대역을 쓴다
const sel = require('../../src/features/menu/menu-selection.ts');
const cartModel = require('../../src/features/cart/cart-model.ts');
const { createCatalogCartValidator } = require('../../src/services/cart/validate-cart.ts');
const { buildSnapshot } = require('../../src/mocks/server/snapshot.ts');
const { parseOrderDto } = require('../../src/services/order/order-dto.ts');
const { parseMenuDetail } = require('../../src/services/supabase/rpc-result.ts');
const { requestItemOptions } = require('../../src/mocks/order/request-options.ts');

/* ---------- 메뉴 픽스처: 기본 25,000원, 소스 700원(수량 허용, 최대 5), 허니 500원(최대 3), 일반 옵션 300원(수량 불가) ---------- */

const M = '00000000-0000-4000-8000-0000000000a1';
const SAUCE = '00000000-0000-4000-8000-0000000000b1';
const HONEY = '00000000-0000-4000-8000-0000000000b2';
const PLAIN = '00000000-0000-4000-8000-0000000000b3';
const X1 = '00000000-0000-4000-8000-0000000000b4';
const X2 = '00000000-0000-4000-8000-0000000000b5';

const menu = () => ({
  id: M,
  storeId: 'store-1',
  storeIsOpen: true,
  name: '치킨',
  description: null,
  imageRef: null,
  price: 25000,
  catalogRevision: 3,
  isSoldOut: false,
  optionGroups: [
    {
      id: 'g-sauce',
      name: '소스',
      minSelect: 0,
      maxSelect: 5,
      options: [
        { id: SAUCE, name: '파.떡.치 소스', additionalPrice: 700, isSoldOut: false, allowQuantity: true, maxQuantity: 5 },
        { id: HONEY, name: '허니 소스', additionalPrice: 500, isSoldOut: false, allowQuantity: true, maxQuantity: 3 },
        { id: PLAIN, name: '일반 옵션', additionalPrice: 300, isSoldOut: false },
      ],
    },
    {
      id: 'g-single',
      name: '단일',
      minSelect: 0,
      maxSelect: 1,
      options: [
        { id: X1, name: '단일 수량 옵션', additionalPrice: 100, isSoldOut: false, allowQuantity: true, maxQuantity: 4 },
        { id: X2, name: '단일 다른 옵션', additionalPrice: 200, isSoldOut: false },
      ],
    },
  ],
});

const pick = (...ids) => ({ 'g-sauce': ids.filter((i) => [SAUCE, HONEY, PLAIN].includes(i)), 'g-single': ids.filter((i) => [X1, X2].includes(i)) });

/* ---------- 가격 ---------- */

test('소스 2개를 고르면 추가금이 1,400원이다', () => {
  const m = menu();
  const s = pick(SAUCE);
  const q = sel.setOptionQuantity(m, s, {}, SAUCE, 2);
  assert.equal(sel.unitPrice(m, s, q) - m.price, 1400);
  assert.equal(sel.unitPrice(m, s, q), 26400);
});

test('기본 25,000원 + 소스 700원×2개, 메뉴 2개 = 52,800원', () => {
  const m = menu();
  const s = pick(SAUCE);
  const q = sel.setOptionQuantity(m, s, {}, SAUCE, 2);
  assert.equal(sel.unitPrice(m, s, q) * 2, 52800);
  assert.equal((25000 + 700 * 2) * 2, 52800);
});

test('옵션 수량을 정하지 않으면 모두 1개라 기존 금액과 같다', () => {
  const m = menu();
  const s = pick(SAUCE, PLAIN);
  assert.equal(sel.unitPrice(m, s), 25000 + 700 + 300);
  assert.equal(sel.unitPrice(m, s, {}), sel.unitPrice(m, s));
});

test('옵션 두 개의 수량이 각각 합산된다', () => {
  const m = menu();
  const s = pick(SAUCE, HONEY);
  let q = sel.setOptionQuantity(m, s, {}, SAUCE, 3);
  q = sel.setOptionQuantity(m, s, q, HONEY, 2);
  assert.equal(sel.unitPrice(m, s, q), 25000 + 700 * 3 + 500 * 2);
});

/* ---------- 수량 규칙 ---------- */

test('수량을 허용하지 않는 옵션의 수량은 바꿀 수 없다', () => {
  const m = menu();
  const s = pick(PLAIN);
  assert.deepEqual(sel.setOptionQuantity(m, s, {}, PLAIN, 3), {});
  assert.equal(sel.unitPrice(m, s, sel.setOptionQuantity(m, s, {}, PLAIN, 3)), 25300);
});

test('고르지 않은 옵션의 수량은 바꿀 수 없다', () => {
  const m = menu();
  assert.deepEqual(sel.setOptionQuantity(m, pick(), {}, SAUCE, 3), {});
});

test('수량은 1 ~ 옵션의 maxQuantity 안으로 맞춰진다 (원본 1000을 쓰지 않는다)', () => {
  const m = menu();
  const s = pick(SAUCE);
  assert.deepEqual(sel.setOptionQuantity(m, s, {}, SAUCE, 99), { [SAUCE]: 5 });
  assert.deepEqual(sel.setOptionQuantity(m, s, {}, SAUCE, 1000), { [SAUCE]: 5 });
  assert.deepEqual(sel.setOptionQuantity(m, s, {}, SAUCE, 0), {});
  assert.deepEqual(sel.setOptionQuantity(m, s, {}, SAUCE, -3), {});
  assert.deepEqual(sel.setOptionQuantity(m, s, {}, SAUCE, 2.9), { [SAUCE]: 2 });
});

test('수량 1은 담지 않는다(없으면 1개), 2개 이상만 담는다', () => {
  const m = menu();
  const s = pick(SAUCE);
  let q = sel.setOptionQuantity(m, s, {}, SAUCE, 3);
  assert.deepEqual(q, { [SAUCE]: 3 });
  q = sel.setOptionQuantity(m, s, q, SAUCE, 1);
  assert.deepEqual(q, {});
  assert.equal(sel.quantityOf(q, SAUCE), 1);
});

test('선택을 해제하면 그 옵션의 수량이 지워진다', () => {
  const m = menu();
  const q = sel.setOptionQuantity(m, pick(SAUCE), {}, SAUCE, 4);
  assert.deepEqual(sel.pruneQuantities(m, pick(), q), {});
  assert.deepEqual(sel.pruneQuantities(m, pick(SAUCE), q), { [SAUCE]: 4 });
});

test('maxQuantity가 1이거나 허용하지 않는 옵션은 수량 조절 대상이 아니다', () => {
  const o = (extra) => ({ id: 'x', name: 'x', additionalPrice: 1, isSoldOut: false, ...extra });
  assert.equal(sel.allowsQuantity(o({})), false);
  assert.equal(sel.allowsQuantity(o({ allowQuantity: false, maxQuantity: null })), false);
  assert.equal(sel.allowsQuantity(o({ allowQuantity: true, maxQuantity: 1 })), false);
  assert.equal(sel.allowsQuantity(o({ allowQuantity: true, maxQuantity: 2 })), true);
});

test('옵션 이름: 수량이 2개 이상일 때만 ×N을 붙인다', () => {
  const m = menu();
  const s = pick(SAUCE, PLAIN);
  assert.deepEqual(sel.selectedOptionNames(m, s), ['파.떡.치 소스', '일반 옵션']);
  assert.deepEqual(sel.selectedOptionNames(m, s, { [SAUCE]: 2 }), ['파.떡.치 소스 ×2', '일반 옵션']);
});

/* ---------- 그룹 선택 제한: 고른 옵션 '종류 수' 기준 (수량 합계가 아니다) ---------- */

test('그룹 최대 1개: 다른 옵션을 누르면 바뀌고, 같은 옵션의 수량은 종류 수에 영향이 없다', () => {
  const m = menu();
  const group = m.optionGroups[1];
  let s = sel.toggleOption({}, group, X1);
  assert.deepEqual(s['g-single'], [X1]);
  const q = sel.setOptionQuantity(m, s, {}, X1, 3);
  assert.equal(sel.unitPrice(m, s, q), 25000 + 100 * 3);
  s = sel.toggleOption(s, group, X2);
  assert.deepEqual(s['g-single'], [X2]);
  assert.deepEqual(sel.pruneQuantities(m, s, q), {});
});

test('그룹 최대 개수에 닿으면 안 고른 옵션이 잠긴다 (종류 수 기준)', () => {
  const m = menu();
  const group = { ...m.optionGroups[0], maxSelect: 2 };
  let s = sel.toggleOption({}, group, SAUCE);
  s = sel.toggleOption(s, group, HONEY);
  const blocked = sel.toggleOption(s, group, PLAIN);
  assert.deepEqual(blocked['g-sauce'], [SAUCE, HONEY]);
});

/* ---------- 장바구니 ---------- */

const base = (extra = {}) => ({
  storeId: 'store-1',
  menuId: M,
  optionIds: [SAUCE],
  quantity: 1,
  unitPrice: 25700,
  catalogRevision: 3,
  menuName: '치킨',
  optionNames: ['파.떡.치 소스'],
  imageRef: null,
  ...extra,
});

test('장바구니: 같은 메뉴라도 옵션 수량이 다르면 별도 항목이다', () => {
  let cart = cartModel.createEmptyCart();
  cart = cartModel.addToCart(cart, base()).cart;
  const r = cartModel.addToCart(cart, base({ optionQuantities: { [SAUCE]: 2 }, unitPrice: 26400, optionNames: ['파.떡.치 소스 ×2'] }));
  assert.equal(r.ok, true);
  assert.equal(r.cart.items.length, 2);
  assert.equal(r.cart.items[1].optionQuantities[SAUCE], 2);
  assert.equal(cartModel.cartTotal(r.cart), 25700 + 26400);
});

test('장바구니: 같은 메뉴·같은 옵션 수량은 한 항목으로 합쳐지고 메뉴 수량이 늘어난다', () => {
  let cart = cartModel.createEmptyCart();
  cart = cartModel.addToCart(cart, base({ optionQuantities: { [SAUCE]: 2 }, unitPrice: 26400 })).cart;
  const r = cartModel.addToCart(cart, base({ optionQuantities: { [SAUCE]: 2 }, unitPrice: 26400, quantity: 2 }));
  assert.equal(r.cart.items.length, 1);
  assert.equal(r.cart.items[0].quantity, 3);
  assert.equal(cartModel.cartTotal(r.cart), 26400 * 3);
});

test('장바구니: 옵션 수량 1은 수량 없는 항목과 같은 항목이다(옛 장바구니와 합쳐진다)', () => {
  let cart = cartModel.createEmptyCart();
  cart = cartModel.addToCart(cart, base()).cart;
  const r = cartModel.addToCart(cart, base({ optionQuantities: { [SAUCE]: 1 } }));
  assert.equal(r.cart.items.length, 1);
  assert.equal(r.cart.items[0].quantity, 2);
  assert.equal('optionQuantities' in r.cart.items[0], false);
});

test('장바구니 키: 옵션 수량이 없으면 옵션 수량 도입 전과 같은 키다', () => {
  assert.equal(cartModel.configurationKey(M, [SAUCE, HONEY]), `${M}|${[SAUCE, HONEY].sort().join(',')}`);
  assert.equal(cartModel.configurationKey(M, [HONEY, SAUCE]), cartModel.configurationKey(M, [SAUCE, HONEY]));
  assert.notEqual(cartModel.configurationKey(M, [SAUCE], { [SAUCE]: 2 }), cartModel.configurationKey(M, [SAUCE]));
  assert.notEqual(cartModel.configurationKey(M, [SAUCE], { [SAUCE]: 2 }), cartModel.configurationKey(M, [SAUCE], { [SAUCE]: 3 }));
  assert.equal(cartModel.configurationKey(M, [SAUCE], { [SAUCE]: 1 }), cartModel.configurationKey(M, [SAUCE]));
});

test('장바구니 키: 고르지 않은 옵션의 수량은 무시된다', () => {
  assert.equal(cartModel.configurationKey(M, [SAUCE], { [HONEY]: 3 }), cartModel.configurationKey(M, [SAUCE]));
});

test('저장·복원: 옵션 수량이 있는 장바구니가 그대로 복원되고, 옛 장바구니(필드 없음)도 읽힌다', () => {
  let cart = cartModel.createEmptyCart();
  cart = cartModel.addToCart(cart, base({ optionQuantities: { [SAUCE]: 3 }, unitPrice: 27100 })).cart;
  const restored = cartModel.parseGuestCart(JSON.parse(JSON.stringify(cart)));
  assert.ok(restored);
  assert.deepEqual(restored.items[0].optionQuantities, { [SAUCE]: 3 });

  const legacy = cartModel.addToCart(cartModel.createEmptyCart(), base()).cart;
  assert.equal('optionQuantities' in legacy.items[0], false);
  assert.ok(cartModel.parseGuestCart(JSON.parse(JSON.stringify(legacy))));
});

test('복원 검사: 잘못된 옵션 수량은 거절한다', () => {
  const make = (optionQuantities) => {
    const cart = cartModel.addToCart(cartModel.createEmptyCart(), base()).cart;
    const raw = JSON.parse(JSON.stringify(cart));
    raw.items[0].optionQuantities = optionQuantities;
    return cartModel.parseGuestCart(raw);
  };
  assert.equal(make({ [SAUCE]: 1 }), null); // 1은 담지 않는다
  assert.equal(make({ [SAUCE]: 0 }), null);
  assert.equal(make({ [SAUCE]: -2 }), null);
  assert.equal(make({ [SAUCE]: 2.5 }), null);
  assert.equal(make({ [SAUCE]: '2' }), null);
  assert.equal(make({ [HONEY]: 2 }), null); // 고르지 않은 옵션
  assert.equal(make([2]), null);
  assert.equal(make(null), null);
  assert.ok(make({ [SAUCE]: 2 }));
});

/* ---------- 주문 요청 ---------- */

test('주문 요청: 옵션 수량이 없으면 이전과 같은 v2(optionIds)다', async () => {
  const w = createWorld();
  const cart = cartModel.addToCart(cartModel.createEmptyCart(), base({ optionIds: [SAUCE], unitPrice: 25700 })).cart;
  const req = w.actions.buildCreateOrderRequest(cart, w.account());
  assert.equal(req.requestVersion, 2);
  assert.deepEqual(req.items[0].optionIds, [SAUCE]);
  assert.equal('options' in req.items[0], false);
  assert.equal(req.approvedTotalAmount, 25700);
});

test('주문 요청: 옵션 수량이 2개 이상이면 v3(options)이고 모든 항목이 같은 모양이다', async () => {
  const w = createWorld();
  let cart = cartModel.addToCart(cartModel.createEmptyCart(), base({ optionIds: [SAUCE, HONEY], optionQuantities: { [SAUCE]: 2 }, unitPrice: 26900, quantity: 2 })).cart;
  cart = cartModel.addToCart(cart, base({ menuId: 'other-menu', optionIds: [], unitPrice: 8000 })).cart;
  const req = w.actions.buildCreateOrderRequest(cart, w.account());
  assert.equal(req.requestVersion, 3);
  const first = req.items[0];
  assert.equal('optionIds' in first, false);
  const byId = Object.fromEntries(first.options.map((o) => [o.optionId, o.quantity]));
  assert.deepEqual(byId, { [SAUCE]: 2, [HONEY]: 1 });
  assert.equal(first.options.length, 2); // 같은 옵션을 두 번 보내지 않는다
  assert.deepEqual(req.items[1].options, []);
  assert.equal(req.approvedTotalAmount, 26900 * 2 + 8000);
});

test('요청 항목 옵션: v2는 옵션마다 1개, v3는 그대로, 중복·혼합·잘못된 수량은 null', () => {
  assert.deepEqual(requestItemOptions({ menuId: M, optionIds: [SAUCE], quantity: 1 }), [{ optionId: SAUCE, quantity: 1 }]);
  assert.deepEqual(requestItemOptions({ menuId: M, options: [{ optionId: SAUCE, quantity: 2 }], quantity: 1 }), [{ optionId: SAUCE, quantity: 2 }]);
  assert.equal(requestItemOptions({ menuId: M, optionIds: [SAUCE, SAUCE], quantity: 1 }), null);
  assert.equal(requestItemOptions({ menuId: M, options: [{ optionId: SAUCE, quantity: 1 }, { optionId: SAUCE.toUpperCase(), quantity: 2 }], quantity: 1 }), null);
  assert.equal(requestItemOptions({ menuId: M, optionIds: [], options: [], quantity: 1 }), null);
  assert.equal(requestItemOptions({ menuId: M, quantity: 1 }), null);
  for (const bad of [0, -1, 1.5]) assert.equal(requestItemOptions({ menuId: M, options: [{ optionId: SAUCE, quantity: bad }], quantity: 1 }), null);
});

/* ---------- 서버 모드 장바구니 확인 ---------- */

const validator = () => createCatalogCartValidator({ getMenu: async () => menu() });
const input = (extra) => ({ storeId: 'store-1', items: [{ clientItemId: 'c1', menuId: M, optionIds: [SAUCE], acknowledgedUnitPrice: 25700, ...extra }] });

test('장바구니 확인: 옵션 수량을 곱한 가격으로 비교한다', async () => {
  const ok = await validator()(input({ optionQuantities: { [SAUCE]: 2 }, acknowledgedUnitPrice: 26400 }));
  assert.equal(ok.items.c1.status, 'VALID');
  assert.equal(ok.items.c1.currentUnitPrice, 26400);
  const stale = await validator()(input({ optionQuantities: { [SAUCE]: 2 }, acknowledgedUnitPrice: 25700 }));
  assert.equal(stale.items.c1.status, 'PRICE_CHANGED');
  assert.equal(stale.items.c1.currentUnitPrice, 26400);
});

test('장바구니 확인: 옵션 수량이 없는 옛 항목은 그대로 VALID', async () => {
  const r = await validator()(input({}));
  assert.equal(r.items.c1.status, 'VALID');
});

test('장바구니 확인: 상한 초과·수량 불가 옵션의 수량은 OPTIONS_INVALID', async () => {
  const over = await validator()(input({ optionQuantities: { [SAUCE]: 6 }, acknowledgedUnitPrice: 25000 + 700 * 6 }));
  assert.equal(over.items.c1.status, 'OPTIONS_INVALID');
  const notAllowed = await validator()(input({ optionIds: [PLAIN], optionQuantities: { [PLAIN]: 2 }, acknowledgedUnitPrice: 25600 }));
  assert.equal(notAllowed.items.c1.status, 'OPTIONS_INVALID');
});

test('장바구니 확인: 그룹 개수는 종류 수 기준이라 같은 옵션 수량으로는 한도를 넘지 않는다', async () => {
  const r = await validator()(input({ optionIds: [X1], optionQuantities: { [X1]: 3 }, acknowledgedUnitPrice: 25300 }));
  assert.equal(r.items.c1.status, 'VALID');
  const two = await validator()(input({ optionIds: [X1, X2], acknowledgedUnitPrice: 25300 }));
  assert.equal(two.items.c1.status, 'OPTIONS_INVALID');
});

/* ---------- 주문 Snapshot · 응답 ---------- */

test('Snapshot: 옵션 수량과 적용 가격이 보존된다', () => {
  const { mockStores, mockMenus } = require('../../src/mocks/catalog/data.ts');
  const store = mockStores[0];
  const mock = mockMenus.find((m) => m.storeId === store.id && m.optionGroups.some((g) => g.options.some((o) => o.allowQuantity)));
  assert.ok(mock, '옵션 수량 확인용 Mock 메뉴가 있다');
  const option = mock.optionGroups.flatMap((g) => g.options).find((o) => o.allowQuantity);
  const { snapshot, total } = buildSnapshot(store.id, [{ menuId: mock.id, optionIds: [option.id], optionQuantities: { [option.id]: 3 }, quantity: 2 }], { bankName: '토스뱅크', last4: '1234' });
  const line = snapshot.items[0];
  assert.equal(line.options[0].quantity, 3);
  assert.equal(line.options[0].additionalPrice, option.additionalPrice);
  assert.equal(line.unitPrice, mock.price + option.additionalPrice * 3);
  assert.equal(line.lineTotal, (mock.price + option.additionalPrice * 3) * 2);
  assert.equal(total, line.lineTotal);
});

const dto = (options) => ({
  orderId: 'o1', status: 'PENDING', statusRevision: 1, createdAt: '2026-11-17T00:00:00Z', completedAt: null, cancelledAt: null, totalAmount: 26400,
  snapshot: { store: { id: 's', name: 'n', imageRef: null, categoryName: 'c' }, items: [{ menuId: M, menuName: '치킨', menuImageRef: null, unitPrice: 26400, quantity: 1, lineTotal: 26400, options }] },
});

test('주문 응답: 옵션 수량이 있으면 읽고, 옛 응답(필드 없음)은 1개로 읽는다', () => {
  const withQty = parseOrderDto(dto([{ groupName: '소스', optionName: '파.떡.치 소스', additionalPrice: 700, quantity: 2 }]), 'k');
  assert.equal(withQty.snapshot.items[0].options[0].quantity, 2);
  const legacy = parseOrderDto(dto([{ groupName: '소스', optionName: '파.떡.치 소스', additionalPrice: 700 }]), 'k');
  assert.equal(legacy.snapshot.items[0].options[0].quantity, 1);
  assert.equal(legacy.approvedTotalAmount, 26400); // 저장된 금액을 다시 계산하지 않는다
});

test('주문 응답: 잘못된 옵션 수량은 거절한다', () => {
  for (const bad of [0, -1, 1.5, '2', null]) {
    assert.throws(() => parseOrderDto(dto([{ groupName: 'g', optionName: 'o', additionalPrice: 1, quantity: bad }]), 'k'));
  }
});

test('메뉴 응답: 옵션 수량 필드가 없어도 읽고, 있으면 형식을 검사한다', () => {
  const ok = menu();
  assert.ok(parseMenuDetail(ok));
  const legacy = menu();
  delete legacy.optionGroups[0].options[0].allowQuantity;
  delete legacy.optionGroups[0].options[0].maxQuantity;
  assert.ok(parseMenuDetail(legacy));
  for (const patch of [{ allowQuantity: 'yes' }, { maxQuantity: 0 }, { maxQuantity: 2.5 }, { maxQuantity: '5' }]) {
    const bad = menu();
    Object.assign(bad.optionGroups[0].options[0], patch);
    assert.throws(() => parseMenuDetail(bad));
  }
});
