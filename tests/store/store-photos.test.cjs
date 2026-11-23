/**
 * 가게 상세 사진 갤러리: 서버 응답 계약(photos 선택 필드), 보여 줄 사진 목록, 넘김·장수 표시 규칙, 구버전 응답 호환.
 * 서버(get_store)와 도구가 쓰는 경로 규칙이 실제 resolveImageUrl을 통과하는지도 본다.
 */
process.env.EXPO_PUBLIC_DATA_SOURCE = 'supabase';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
require('../order/harness.cjs');
const { storePhotoUris, pageIndexFromOffset, photoCounterLabel } = require('../../src/features/store/store-photos.ts');
const { parseStoreDetail } = require('../../src/services/supabase/rpc-result.ts');
const { resolveImageUrl } = require('../../src/services/image.ts');

const BASE = 'https://example-project.supabase.co/storage/v1/object/public/menu-images/';
const SID = 'b6322307-c104-5044-a048-ac4c96a5409b';
const ref = (h) => `stores/${SID}-${h}.jpg`;
const store = (extra) => ({ id: SID, name: '피자스쿨', description: null, imageRef: `stores/${SID}.jpg`, isOpen: true, isRecommended: false,
  category: { id: 'c', code: 'x', name: 'x' }, reviewSummary: { count: 0, averageCravingRating: null }, isFavorite: null, menus: [], menuGroups: [], ...extra });

test('photos가 있으면 서버 순서대로(첫 장 = 대표), 기존·신규 경로 모두 공개 URL로 변환', () => {
  const s = store({ photos: [{ imageRef: ref('11111111') }, { imageRef: ref('22222222') }, { imageRef: `stores/${SID}.jpg` }] });
  assert.deepEqual(storePhotoUris(s), [BASE + ref('11111111'), BASE + ref('22222222'), BASE + `stores/${SID}.jpg`]);
});

test('그릴 수 없는 경로는 건너뛰고 중복은 한 번만, 그릴 수 있는 사진이 없으면 기존 대표사진 한 장', () => {
  assert.deepEqual(storePhotoUris(store({ photos: [{ imageRef: 'mock/x.png' }, { imageRef: ref('11111111') }, { imageRef: ref('11111111') }] })), [BASE + ref('11111111')]);
  assert.deepEqual(storePhotoUris(store({ photos: [{ imageRef: 'mock/x.png' }] })), [BASE + `stores/${SID}.jpg`]);
});

test('구버전 응답(photos 없음)·빈 배열은 기존 대표사진 한 장, 사진이 전혀 없으면 [null](Placeholder)', () => {
  assert.deepEqual(storePhotoUris(store({})), [BASE + `stores/${SID}.jpg`]);
  assert.deepEqual(storePhotoUris(store({ photos: [] })), [BASE + `stores/${SID}.jpg`]);
  assert.deepEqual(storePhotoUris(store({ imageRef: null })), [null]);
  assert.deepEqual(storePhotoUris(store({ imageRef: null, photos: [] })), [null]);
});

test('응답 검증: photos는 선택 필드, 있으면 모양이 맞아야 한다(구버전 응답은 그대로 통과)', () => {
  assert.doesNotThrow(() => parseStoreDetail(store({})));
  assert.doesNotThrow(() => parseStoreDetail(store({ photos: [] })));
  assert.doesNotThrow(() => parseStoreDetail(store({ photos: [{ imageRef: ref('11111111') }] })));
  assert.throws(() => parseStoreDetail(store({ photos: 'x' })));
  assert.throws(() => parseStoreDetail(store({ photos: [{ imageRef: 5 }] })));
  assert.throws(() => parseStoreDetail(store({ photos: [null] })));
});

test('넘김 위치와 장수 표시: 한 장·없음은 표시 없음, 2장 이상은 현재/전체', () => {
  assert.equal(photoCounterLabel(0, 0), null); assert.equal(photoCounterLabel(0, 1), null);
  assert.equal(photoCounterLabel(0, 7), '1/7'); assert.equal(photoCounterLabel(6, 7), '7/7');
  assert.equal(pageIndexFromOffset(0, 390, 5), 0); assert.equal(pageIndexFromOffset(390, 390, 5), 1);
  assert.equal(pageIndexFromOffset(780.4, 390, 5), 2); assert.equal(pageIndexFromOffset(99999, 390, 5), 4);
  assert.equal(pageIndexFromOffset(-30, 390, 5), 0); assert.equal(pageIndexFromOffset(100, 0, 5), 0); assert.equal(pageIndexFromOffset(100, 390, 0), 0);
});

test('실제 Guest 응답(갤러리 도입 전 응답)도 기존 대표사진 한 장으로 보인다', () => {
  for (const f of ['hansot-real-guest-store.json', 'sulbing-real-guest-store.json', 'bobae-real-guest-store.json']) {
    const st = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));
    assert.equal(st.photos, undefined);
    assert.deepEqual(storePhotoUris(st), [resolveImageUrl(st.imageRef)]);
  }
});

test('16개 가게 사진 계획: 새 경로 66개가 모두 resolveImageUrl을 통과하고, 첫 장 = 대표(굽네 4번·도미노 2번·나머지 1번), 나머지는 원본 순서', () => {
  const map = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'imports', 'store-photos-20261123', 'stores_map.json'), 'utf8')).stores;
  assert.equal(map.length, 16);
  assert.equal(map.reduce((n, s) => n + s.photos.length, 0), 66);
  const counts = Object.fromEntries(map.map((s) => [s.key, s.photos.length]));
  assert.deepEqual(counts, { goobne: 7, yeopgi: 4, domino: 6, baeksojeong: 3, burgerking: 3, bobae: 4, sulbing: 2, hansot: 4, bhc: 5, momstouch: 5, megamgc: 3, misoya: 3, bonjuk: 4, sinjeon: 3, jjambbongjizon: 5, pizzaschool: 5 });
  for (const s of map) {
    const uris = storePhotoUris({ imageRef: `stores/${s.store_id}.png`, photos: s.photos.map((p) => ({ imageRef: p.object_path })) });
    assert.equal(uris.length, s.photos.length, s.key);
    assert.ok(uris.every((u) => u && u.startsWith(BASE + `stores/${s.store_id}-`)), s.key);
    assert.equal(s.photos[0].source_position, { goobne: 4, domino: 2 }[s.key] ?? 1, s.key);
    assert.deepEqual(s.photos.slice(1).map((p) => p.source_position), s.photos.map((p) => p.source_position).sort((a, b) => a - b).filter((n) => n !== s.photos[0].source_position), s.key);
    assert.equal(photoCounterLabel(0, uris.length), uris.length >= 2 ? `1/${uris.length}` : null);
  }
});
