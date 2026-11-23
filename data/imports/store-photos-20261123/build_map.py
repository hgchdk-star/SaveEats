# -*- coding: utf-8 -*-
"""
수집 폴더(store-photos-coupangeats-20261123)의 store_photos.json을 읽어 stores_map.json(가게별 사진 계획)을 만든다. 수집 파일은 읽기만 한다.
경로 규칙: 대표·갤러리 사진은 파일마다 별도 경로 stores/<가게 UUID>-<파일 sha256 앞 8자리>.jpg (기존 stores/<UUID>.<확장자> 파일은 지우지 않는다).
순서: sort_order 0 = 대표 후보(원본 위치 representative_candidate_position), 그 뒤는 대표를 뺀 나머지를 원본 순서대로.
"""
import hashlib, io, json, os, sys
BASE = os.path.dirname(os.path.abspath(__file__))
PKG = sys.argv[1]
J = lambda p: json.load(io.open(p, encoding='utf-8'))
src = J(os.path.join(PKG, 'store_photos.json'))
out = []
for s in src:
    sid = s['saveeats_store_id']
    ph = sorted(s['photos'], key=lambda p: p['source_position'])
    assert [p['source_position'] for p in ph] == list(range(1, len(ph) + 1)), s['brand_key']
    assert len(ph) == s['verified_screen_count'] == s['source_photo_count'] and s['screen_count_matches'], s['brand_key']
    rep = s['representative_candidate_position']
    assert 1 <= rep <= len(ph)
    order = [p for p in ph if p['source_position'] == rep] + [p for p in ph if p['source_position'] != rep]
    items, seen = [], set()
    for i, p in enumerate(order):
        data = open(os.path.join(PKG, p['local_path']), 'rb').read()
        sha = hashlib.sha256(data).hexdigest()
        assert sha == p['sha256'] and data[:3] == b'\xff\xd8\xff', (s['brand_key'], p['source_position'])
        ref = f'stores/{sid}-{sha[:8]}.jpg'
        assert ref not in seen, ('같은 가게 안에서 해시 앞 8자리 충돌', ref)
        seen.add(ref)
        items.append({'sort_order': i, 'source_position': p['source_position'], 'object_path': ref, 'sha256': sha, 'bytes': len(data), 'local_path': p['local_path'], 'source_url': p['source_url'], 'rights_status': p.get('rights_status', '미확인')})
    out.append({'key': s['brand_key'], 'store_id': sid, 'store_name': s['saveeats_store_name'], 'branch_name': s['store_name'], 'source_store_id': s['source_store_id'],
                'source_field': s['source_field'], 'representative_source_position': rep, 'representative_basis': s['representative_selection_basis'], 'photos': items})
io.open(os.path.join(BASE, 'stores_map.json'), 'w', encoding='utf-8').write(json.dumps({'_comment': '가게별 대표·상세 사진 계획. 사진 권리 상태는 미확인(쿠팡이츠 가게 상단 이미지). 수집 파일은 저장소 밖에 있다.', 'collected_date': '2026-11-23', 'stores': out}, ensure_ascii=False, indent=1) + '\n')
print(len(out), '개 가게', sum(len(s['photos']) for s in out), '장')
