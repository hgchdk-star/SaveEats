/** 개발 전용 사진 미리보기: 꺼져 있으면 아무것도 바꾸지 않고, 켜져 있으면(개발 모드 + 환경변수) 가게 사진 경로만 미리보기 서버로 바꾼다. */
process.env.EXPO_PUBLIC_DATA_SOURCE = 'supabase';
process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example-project.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'test-public-key';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../order/harness.cjs');
const pv = require('../../src/services/store-photo-preview.ts');
const { resolveImageUrl } = require('../../src/services/image.ts');

const SID = 'b6322307-c104-5044-a048-ac4c96a5409b';
const REAL = 'https://example-project.supabase.co/storage/v1/object/public/menu-images/';
const set = (dev, url) => { globalThis.__DEV__ = dev; if (url) process.env.EXPO_PUBLIC_STORE_PHOTO_PREVIEW_URL = url; else delete process.env.EXPO_PUBLIC_STORE_PHOTO_PREVIEW_URL; };

test('꺼져 있으면(환경변수 없음 또는 출시 빌드) 원래 주소 그대로', () => {
  set(true, null); assert.equal(pv.storePhotoPreviewBase(), null);
  assert.equal(resolveImageUrl(`stores/${SID}.jpg`), `${REAL}stores/${SID}.jpg`);
  set(false, 'http://192.168.0.5:8099'); assert.equal(pv.storePhotoPreviewBase(), null);
  assert.equal(resolveImageUrl(`stores/${SID}-ff22956c.jpg`), `${REAL}stores/${SID}-ff22956c.jpg`);
  set(false, null);
});

test('켜면 가게 사진 경로만 미리보기 서버 주소로 바뀌고, 메뉴 사진·잘못된 경로는 영향이 없다', () => {
  set(true, 'http://192.168.0.5:8099/');
  assert.equal(resolveImageUrl(`stores/${SID}-ff22956c.jpg`), `http://192.168.0.5:8099/img/stores/${SID}-ff22956c.jpg?fallback=${encodeURIComponent(REAL + `stores/${SID}-ff22956c.jpg`)}`);
  assert.equal(resolveImageUrl(`stores/${SID}.png`), `http://192.168.0.5:8099/rep/${SID}?fallback=${encodeURIComponent(REAL + `stores/${SID}.png`)}`);
  assert.equal(resolveImageUrl(`menus/${SID}.png`), `${REAL}menus/${SID}.png`);
  assert.equal(resolveImageUrl('stores/../x.png'), null);
  set(false, null);
});

test('갤러리 사진이 없는 응답은 미리보기 목록으로 채우고, 이미 있으면 그대로, 실패하면 원본 응답', async () => {
  const store = { id: SID, imageRef: `stores/${SID}.png`, photos: undefined };
  set(true, 'http://localhost:8099');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ imageRef: `stores/${SID}-ff22956c.jpg`, photos: [{ imageRef: `stores/${SID}-ff22956c.jpg` }, { imageRef: `stores/${SID}-aaaaaaaa.jpg` }] }) });
  const r = await pv.withPreviewPhotos(store);
  assert.equal(r.photos.length, 2); assert.equal(r.imageRef, r.photos[0].imageRef);
  const has = { ...store, photos: [{ imageRef: `stores/${SID}-bbbbbbbb.jpg` }] };
  assert.equal(await pv.withPreviewPhotos(has), has);
  globalThis.fetch = async () => { throw new Error('x'); };
  assert.equal(await pv.withPreviewPhotos(store), store);
  globalThis.fetch = async () => ({ ok: false });
  assert.equal(await pv.withPreviewPhotos(store), store);
  globalThis.fetch = realFetch;
  set(false, null);
  assert.equal(await pv.withPreviewPhotos(store), store);
});
