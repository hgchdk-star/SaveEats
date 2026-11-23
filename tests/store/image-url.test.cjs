/**
 * resolveImageUrl: 기존 UUID 경로와 교체 사진의 해시 접미사 경로(menus/<UUID>-<8자리 해시>.jpg)를 공개 이미지 URL로 바꾸고,
 * 그 밖의 모양(경로 이동·다른 버킷·가게 사진의 해시 접미사·긴 해시)은 null로 거부한다. 실제 Guest 응답 픽스처로 회귀 시험한다.
 */
process.env.EXPO_PUBLIC_DATA_SOURCE = 'supabase';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example-project.supabase.co/';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../order/harness.cjs');
const { resolveImageUrl } = require('../../src/services/image.ts');

const BASE = 'https://example-project.supabase.co/storage/v1/object/public/menu-images/';
const fx = path.join(__dirname, 'fixtures');
const STORES = [
  ...['bhc', 'momstouch', 'megamgc', 'misoya', 'bonjuk', 'sinjeon', 'jjambbongjizon', 'pizzaschool'].map((k) => [k, `catalog-real/${k}-store.json`]),
  ['hansot', 'hansot-real-guest-store.json'],
];
const HASHED = /^menus\/[0-9a-f-]{36}-[0-9a-f]{8}\.(?:png|jpe?g)$/;

test('기존 UUID 경로와 가게 사진 경로는 그대로 공개 URL로 바뀐다', () => {
  const id = '6854fd60-0e8c-5461-ad4c-1818ecd3c76a';
  assert.equal(resolveImageUrl(`menus/${id}.jpg`), `${BASE}menus/${id}.jpg`);
  assert.equal(resolveImageUrl(`menus/${id}.PNG`), `${BASE}menus/${id}.PNG`);
  assert.equal(resolveImageUrl(`stores/${id}.jpeg`), `${BASE}stores/${id}.jpeg`);
  assert.equal(resolveImageUrl(`stores/${id}.png`), `${BASE}stores/${id}.png`);
});

test('교체 사진의 해시 접미사 경로를 허용한다', () => {
  const id = '6854fd60-0e8c-5461-ad4c-1818ecd3c76a';
  assert.equal(resolveImageUrl(`menus/${id}-5ec9105f.jpg`), `${BASE}menus/${id}-5ec9105f.jpg`);
  assert.equal(resolveImageUrl(`menus/${id}-2dd2953e.png`), `${BASE}menus/${id}-2dd2953e.png`);
  // 가게 대표·갤러리 사진도 같은 모양(별도 경로, 파일마다 다른 해시)
  assert.equal(resolveImageUrl(`stores/${id}-9b4a6d1a.jpg`), `${BASE}stores/${id}-9b4a6d1a.jpg`);
});

test('좁은 검사 유지: 이상한 경로·접미사는 null, 사진 없음(NULL)도 null', () => {
  const id = '6854fd60-0e8c-5461-ad4c-1818ecd3c76a';
  for (const bad of [null, '', `menus/${id}-5ec9105.jpg`, `menus/${id}-5ec9105fa.jpg`, `menus/${id}-5ec9105g.jpg`, `menus/${id}-5ec9105f-5ec9105f.jpg`, `stores/${id}-5ec9105.jpg`, `stores/${id}-5ec9105f-5ec9105f.jpg`, `stores/${id}-5ec9105g.jpg`, `stores/${id}-../x.jpg`, `stores/${id}.gif`,
    `menus/../${id}.jpg`, `menus/${id}-../x.jpg`, `other/${id}.jpg`, `menus/${id}.gif`, `menus/${id}.jpg?x=1`, `https://evil.example/menus/${id}.jpg`, `/menus/${id}.jpg`, `menus/${id}-5ec9105f.jpg/..`, 'menus/mock-image.png']) {
    assert.equal(resolveImageUrl(bad), null, String(bad));
  }
});

test('실제 Guest 응답: 모든 imageRef가 공개 URL로 변환되고 사진이 없는 메뉴는 null(빈 이미지)', () => {
  let withRef = 0, hashed = 0, none = 0;
  for (const [, f] of STORES) {
    const st = JSON.parse(fs.readFileSync(path.join(fx, f), 'utf8'));
    for (const m of st.menus) {
      const url = resolveImageUrl(m.imageRef);
      if (!m.imageRef) { none++; assert.equal(url, null, m.name); continue; }
      withRef++;
      assert.equal(url, BASE + m.imageRef, m.name);
      if (HASHED.test(m.imageRef)) hashed++;
    }
  }
  assert.equal(none, 5);          // 신전 3 + 짬뽕지존 소스 2(보이는 메뉴 중 사진 미확보)
  assert.equal(hashed, 33);       // 8개 가게 연결 메뉴 교체 사진 29 + 한솥 4
  assert.ok(withRef > 600);
});

test('교체 사진 사례: 피자스쿨 포테이토피자·신전 치즈떡볶이·짬뽕지존 지존짬뽕·한솥 4개', () => {
  const find = (f, n) => JSON.parse(fs.readFileSync(path.join(fx, f), 'utf8')).menus.find((m) => m.name === n);
  for (const [f, n] of [['catalog-real/pizzaschool-store.json', '포테이토피자'], ['catalog-real/sinjeon-store.json', '치즈떡볶이'], ['catalog-real/jjambbongjizon-store.json', '지존짬뽕'],
    ['hansot-real-guest-store.json', '치킨마요'], ['hansot-real-guest-store.json', '치킨제육'], ['hansot-real-guest-store.json', '(BEST)돈까스도련님'], ['hansot-real-guest-store.json', '(BEST)돈까스도련님 고기고기']]) {
    const m = find(f, n);
    assert.match(m.imageRef, HASHED, n);
    assert.equal(resolveImageUrl(m.imageRef), BASE + m.imageRef, n);
  }
});
