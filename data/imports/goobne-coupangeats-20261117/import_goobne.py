#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
굽네(쿠팡이츠 서대문 연희점) 수집본을 '기존 굽네치킨 가게'에 확장 적용하는 도구 (개발 서버 전용).

  --check    읽기 전용. 대응표·추가/수정/비활성 개수·미결정 항목을 보고서로 만든다 (DB 또는 --snapshot 파일)
  --backup   적용 전 상태(기존 가게의 메뉴·옵션 원본 행, 주문 스냅샷 해시, 다른 가게 해시)를 backup/<시각>/에 저장
  --apply    백업 → 사진 업로드 → DB 반영(한 트랜잭션) → 검증
  --verify   적용 결과를 관리자·Guest(anon) 권한으로 대조
  --restore  백업 기준으로 되돌린다(새로 만든 행·사진 삭제, 수정한 가격·옵션 활성 상태 복원)

정책 (2026-11-17 서정 결정):
  - 이 지점(서대문 연희점) 메뉴·가격을 기존 굽네치킨 가게의 대표 데이터로 쓴다. 전국 공통가로 확인됐다고 표현하지 않는다.
  - 기존 가게·메뉴 UUID, 주문·리뷰 참조, 주문 스냅샷, 추천·인기 표시, 가게 대표사진은 바꾸지 않는다.
  - 기존 가상 옵션은 삭제하지 않고 비활성 처리한다(과거 참조 보존). 실제 옵션은 새 행으로 추가한다.
  - 파.떡.치 소스는 메뉴 한 개당 최대 10개(메뉴 주문 수량과 별개). 원본 max_quantity=1000은 내부 기록에 남긴다.
  - 쿠팡이츠 숫자 ID는 UUID로 쓰지 않는다(UUIDv5 + id_map.json). 재실행해도 중복이 생기지 않는다.
  - 출처·권리 상태는 '미확인'으로 내부 기록에만 남긴다. 공개 출처 목록(store_sources, 승인 지문 있음)은 건드리지 않는다.
  - 접속 정보는 환경변수나 .env.import(저장소 제외)로만 읽고 출력하지 않는다.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
import uuid

HERE = os.path.dirname(os.path.abspath(__file__))
NAMESPACE = uuid.UUID('6f1c1e2a-0d3b-4c7e-9a52-7b9d3e1f0a11')
SOURCE_SYSTEM = 'coupangeats'
BATCH = 'goobne-coupangeats-20261117'
STORE_ID = 'd5c4fa89-212d-58ca-ac17-b364518e55e3'  # 기존 굽네치킨 가게. UUID 유지
STORE_NAME = '굽네치킨'
BUCKET = 'menu-images'
MAX_IMAGE_BYTES = 2 * 1024 * 1024
NEW_MENU_SORT_BASE = 100  # 기존 메뉴(1~15)를 위에 두고 새 메뉴는 그 뒤에 쿠팡이츠 순서대로
OPTION_MAX_QUANTITY = None  # 서정 결정 2026-11-18: 수량 상한은 수집 원본의 옵션별 maxQuantity를 따른다(임의 상한을 두지 않음). 값을 주면 그 값으로 줄인다
ALCOHOL = re.compile(r'참이슬|진로이즈백|^새로 |카스|테라|생맥주')

EXISTING_SQL = """
select jsonb_build_object(
 'store', (select to_jsonb(x) from (select id::text, name, category_id::text, image_ref, is_active, is_open, is_recommended
            from public.stores where id = %(sid)s::uuid) x),
 'menus', coalesce((select jsonb_agg(to_jsonb(x) order by x.sort_order) from (select id::text, name, description, base_price, image_ref,
            is_active, is_sold_out, is_popular, popularity_score, sort_order from public.menus where store_id = %(sid)s::uuid) x), '[]'::jsonb),
 'groups', coalesce((select jsonb_agg(to_jsonb(x) order by x.menu_id, x.sort_order) from (select g.id::text, g.menu_id::text, g.name,
            g.min_select, g.max_select, g.sort_order, g.is_active from public.menu_option_groups g
            join public.menus m on m.id = g.menu_id where m.store_id = %(sid)s::uuid) x), '[]'::jsonb),
 'options', coalesce((select jsonb_agg(to_jsonb(x) order by x.group_id, x.sort_order) from (select o.id::text, o.group_id::text, o.name,
            o.additional_price, o.is_active, o.is_sold_out, o.sort_order, o.allow_quantity, o.max_quantity from public.menu_options o
            join public.menu_option_groups g on g.id = o.group_id join public.menus m on m.id = g.menu_id where m.store_id = %(sid)s::uuid) x), '[]'::jsonb),
 'refs', jsonb_build_object(
   'orders', (select count(*) from public.orders where store_id = %(sid)s::uuid),
   'order_items', (select count(*) from public.order_items where store_id = %(sid)s::uuid),
   'order_item_options', (select count(*) from public.order_item_options oio join public.order_items oi on oi.id = oio.order_item_id where oi.store_id = %(sid)s::uuid),
   'review_menus', (select count(*) from public.review_menus r join public.menus m on m.id = r.menu_id where m.store_id = %(sid)s::uuid),
   'store_sources', (select count(*) from public.store_sources where store_id = %(sid)s::uuid),
   'store_source_records', (select count(*) from private.store_source_records where store_id = %(sid)s::uuid)),
 'totals', (select to_jsonb(t) from (select
   (select count(*) from public.stores where is_active) stores_active, (select count(*) from public.menus where is_active) menus_active,
   (select count(*) from public.menu_option_groups) groups_total, (select count(*) from public.menu_options) options_total,
   (select count(*) from public.orders) orders_total) t)
)
"""

# 주문 스냅샷은 절대 바뀌면 안 된다. 이 가게 주문의 스냅샷 열 전체를 해시로 남긴다
ORDER_FP_SQL = """
select md5(coalesce((select string_agg(concat_ws('|', oi.id, oi.order_id, oi.menu_id, oi.line_no, oi.menu_name_snapshot, oi.menu_image_snapshot,
        oi.base_price_snapshot, oi.option_total_snapshot, oi.unit_price, oi.quantity, oi.line_total), ',' order by oi.id)
        from public.order_items oi where oi.store_id = %(sid)s::uuid), '')
  || '#' || coalesce((select string_agg(concat_ws('|', oio.id, oio.order_item_id, oio.source_group_id, oio.source_option_id, oio.group_name_snapshot,
        oio.option_name_snapshot, oio.additional_price_snapshot, oio.sort_order, oio.quantity_snapshot), ',' order by oio.id)
        from public.order_item_options oio join public.order_items oi on oi.id = oio.order_item_id where oi.store_id = %(sid)s::uuid), '')
  || '#' || coalesce((select string_agg(concat_ws('|', r.review_id, r.menu_id), ',' order by r.review_id, r.menu_id)
        from public.review_menus r join public.menus m on m.id = r.menu_id where m.store_id = %(sid)s::uuid), ''))
"""

FINGERPRINT_SQL = """
select s.id::text,
       md5(coalesce(string_agg(distinct s.name || '|' || s.is_active::text || '|' || s.is_open::text || '|' || coalesce(s.image_ref, ''), ','), '')
        || '#' || coalesce(string_agg(distinct m.id::text || '|' || m.name || '|' || m.base_price::text || '|' || coalesce(m.image_ref, '') || '|' || m.is_active::text || '|' || m.is_sold_out::text, ',' ), '')
        || '#' || coalesce(string_agg(distinct g.id::text || '|' || g.min_select::text || '|' || g.max_select::text || '|' || g.is_active::text, ','), '')
        || '#' || coalesce(string_agg(distinct o.id::text || '|' || o.additional_price::text || '|' || o.is_active::text, ','), '')) as fp
from public.stores s
left join public.menus m on m.store_id = s.id
left join public.menu_option_groups g on g.menu_id = m.id
left join public.menu_options o on o.group_id = g.id
where s.id <> %(sid)s::uuid
group by s.id order by s.id
"""


# ---------------------------------------------------------------- 환경 · 입출력
def load_env_file():
    path = os.path.join(HERE, '.env.import')
    if not os.path.exists(path):
        return
    for line in open(path, encoding='utf-8'):
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True, default=str)
        f.write('\n')


def uid(*parts):
    return str(uuid.uuid5(NAMESPACE, ':'.join(str(p) for p in parts)))


def sniff_image(path):
    with open(path, 'rb') as f:
        head = f.read(12)
    if head[:3] == b'\xff\xd8\xff':
        return 'jpg', 'image/jpeg'
    if head[:8] == b'\x89PNG\r\n\x1a\n':
        return 'png', 'image/png'
    return None, None


def quantity_rule(group, option):
    """옵션 수량 조절 허용 규칙. (허용 여부, 보류 사유) 를 돌려준다. 후보가 아니면 (False, None).
    후보: 원본 그룹 타입이 SELECT_MULTI_QTY 이고 옵션 maxQuantity >= 2.
    확인된 것(서정이 쿠팡이츠 실제 화면에서 확인, 2026-11-18): '소스&치킨무&피클 추가선택' 그룹의 소스 옵션마다 -/+ 조절기가 뜬다.
      → 그 그룹의 이름에 '소스'가 들어간 옵션, 그리고 원본 quantityChangeable=true 옵션만 켠다.
    그 밖의 후보(치킨무·피클·추블링 살사·치트킹, '최대 2개 가능' 그룹의 옵션)는 화면 확인 전이라 켜지도 끄지도 않고 따로 보고한다."""
    mx = option.get('max_quantity')
    if group['type'] != 'SELECT_MULTI_QTY' or not isinstance(mx, int) or mx < 2:
        return False, None
    if option['quantity_changeable']:
        return True, None
    if '소스&치킨무&피클' in group['name'] and '소스' in option['name']:
        return True, None
    if '소스&치킨무&피클' in group['name']:
        return False, '같은 그룹이지만 이름에 소스가 없어 화면 확인 전(치킨무·피클·추블링 살사·치트킹)'
    return False, "'최대 2개 가능' 그룹: 같은 옵션 반복인지 서로 다른 옵션 합계인지 화면 확인 전"


# ---------------------------------------------------------------- 계획 만들기 (DB를 읽지 않고 existing 상태만 받는다)
def build_plan(package, existing, option_max_quantity=OPTION_MAX_QUANTITY, max_select_mode='source', confirm_links=(), hide_alcohol=True, enable_option_quantity=True):
    menus = read_json(os.path.join(package, 'menus.json'))
    groups = read_json(os.path.join(package, 'menu_option_groups.json'))
    options = read_json(os.path.join(package, 'menu_options.json'))
    photos = read_json(os.path.join(package, 'photo_index.json'))
    mapping = read_json(os.path.join(HERE, 'menu_mapping.json'))['links']
    issues, notes = [], []

    store_ids = {m['source_store_id'] for m in menus}
    if len(store_ids) != 1:
        issues.append(f'수집 가게가 하나가 아니다: {sorted(store_ids)}')
    source_store_id = sorted(store_ids)[0]
    if not existing.get('store') or existing['store']['id'] != STORE_ID:
        issues.append('기존 굽네치킨 가게를 찾지 못했다')

    ex_menus = {m['id']: m for m in existing.get('menus', [])}
    # ---- 대응표
    links, held = {}, []
    for ln in mapping:
        ln = dict(ln)
        if ln['existing_menu_id'] not in ex_menus:
            issues.append(f'대응표의 기존 메뉴가 서버에 없다: {ln["existing_name"]}')
            continue
        if ex_menus[ln['existing_menu_id']]['name'] != ln['existing_name']:
            issues.append(f'기존 메뉴 이름이 대응표와 다르다: {ln["existing_name"]} / {ex_menus[ln["existing_menu_id"]]["name"]}')
        if ln['status'] == 'HOLD' and ln['existing_menu_id'] in confirm_links and ln.get('candidate_source_menu_id'):
            ln['status'], ln['source_menu_id'], ln['basis'] = 'LINK', ln['candidate_source_menu_id'], 'CONFIRMED_BY_PM'
            ln['source_name'] = ln.get('candidate_name')
        if ln['status'] == 'LINK':
            if ln['source_menu_id'] in links:
                issues.append(f'수집 메뉴가 두 기존 메뉴에 연결됨: {ln["source_menu_id"]}')
            links[ln['source_menu_id']] = ln
        else:
            held.append(ln)
    # 이미 반영된 뒤 다시 돌릴 때를 위해, 이 도구가 만든 새 메뉴(UUIDv5)는 '기존 메뉴'로 세지 않는다
    own_new = {uid('menu', SOURCE_SYSTEM, source_store_id, m['source_menu_id']) for m in menus}
    mapped = {l['existing_menu_id'] for l in links.values()} | {h['existing_menu_id'] for h in held}
    unmapped_existing = [m for m in existing.get('menus', []) if m['id'] not in mapped and m['id'] not in own_new]
    for m in unmapped_existing:
        issues.append(f'대응표에 없는 기존 메뉴: {m["name"]}')

    # ---- 메뉴
    menu_rows, menu_uuid, seen = [], {}, set()
    for m in menus:
        sid = m['source_menu_id']
        if sid in seen:
            issues.append(f'메뉴 원본 ID 중복: {sid}')
        seen.add(sid)
        api_price = m['base_price_krw'] is not None
        price = m['base_price_krw'] if api_price else m['price_krw']
        if not isinstance(price, int) or price < 0:
            issues.append(f'메뉴 가격이 올바르지 않다: {sid} {m["name"]}')
        if not (m['name'] or '').strip():
            issues.append(f'메뉴 이름이 비었다: {sid}')
        desc = (m.get('description') or '').strip() or None
        link = links.get(sid)
        if link:
            old = ex_menus[link['existing_menu_id']]
            mid = old['id']
            row = {'kind': 'LINK', 'id': mid, 'name': old['name'], 'source_name': m['name'].strip(), 'old_price': old['base_price'],
                   'old_description': old['description'], 'description': old['description'] or desc,
                   'fills_description': old['description'] is None and desc is not None,
                   'sort_order': old['sort_order'], 'is_active': old['is_active'], 'is_sold_out': old['is_sold_out']}
        else:
            mid = uid('menu', SOURCE_SYSTEM, source_store_id, sid)
            active = not (hide_alcohol and ALCOHOL.search(m['name']))
            row = {'kind': 'NEW', 'id': mid, 'name': m['name'].strip(), 'source_name': m['name'].strip(), 'old_price': None, 'old_description': None,
                   'description': desc, 'fills_description': False, 'sort_order': NEW_MENU_SORT_BASE + int(m['sort_order']),
                   'is_active': active, 'is_sold_out': False}
        row.update({'store_id': STORE_ID, 'base_price': price, 'source_menu_id': sid, 'source_reference': m.get('source_reference'),
                    'price_source': 'API_SALE_PRICE' if api_price else 'UI_DETAIL_PRICE', 'source_sale_status': m.get('sale_status') or '미확인',
                    'alcohol': bool(ALCOHOL.search(m['name']))})
        menu_uuid[sid] = mid
        menu_rows.append(row)
    for sid, ln in links.items():
        if sid not in menu_uuid:
            issues.append(f'대응표의 수집 메뉴가 자료에 없다: {sid}')

    # ---- 그룹
    options_per_group = {}
    for o in options:
        options_per_group[o['group_key']] = options_per_group.get(o['group_key'], 0) + 1
    group_rows, group_uuid = [], {}
    for g in groups:
        if g['source_menu_id'] not in menu_uuid:
            issues.append(f'그룹의 메뉴가 없다: {g["group_key"]}')
            continue
        if g['group_key'] in group_uuid:
            issues.append(f'그룹 키 중복: {g["group_key"]}')
        if not (g['name'] or '').strip():
            issues.append(f'그룹 이름이 비었다: {g["group_key"]}')
        if not (0 <= g['min_select'] <= g['max_select'] and g['max_select'] >= 1):
            issues.append(f'그룹 선택 수가 올바르지 않다: {g["group_key"]}')
        n_opts = options_per_group.get(g['group_key'], 0)
        max_select = g['max_select']
        if max_select_mode == 'options' and max_select >= 1000:
            max_select = max(n_opts, g['min_select'], 1)
        gid = uid('group', SOURCE_SYSTEM, source_store_id, g['source_menu_id'], g['source_group_id'])
        group_uuid[g['group_key']] = gid
        group_rows.append({'id': gid, 'menu_id': menu_uuid[g['source_menu_id']], 'name': g['name'].strip(), 'min_select': g['min_select'],
                           'max_select': max_select, 'source_max_select': g['max_select'], 'option_count': n_opts, 'sort_order': int(g['sort_order']),
                           'group_key': g['group_key'], 'source_type': g['type'], 'source_menu_id': g['source_menu_id']})

    # ---- 옵션
    option_rows, seen_opt = [], set()
    gkey = {g['group_key']: g for g in groups}
    qty_hold = {}
    for o in options:
        if o['group_key'] not in group_uuid:
            issues.append(f'옵션의 그룹이 없다: {o["group_key"]} {o["source_option_id"]}')
            continue
        key = (o['group_key'], o['source_option_id'])
        if key in seen_opt:
            issues.append(f'옵션 키 중복: {key}')
        seen_opt.add(key)
        price = o['extra_price_krw']
        if not isinstance(price, int) or price < 0:
            issues.append(f'옵션 추가금이 올바르지 않다: {key}')
        if not (o['name'] or '').strip():
            issues.append(f'옵션 이름이 비었다: {key}')
        allow, hold = quantity_rule(gkey[o['group_key']], o)
        if not enable_option_quantity:
            allow = False
        src_max = o.get('max_quantity')
        max_q = None
        if allow:
            max_q = min(src_max, option_max_quantity) if option_max_quantity else src_max
        if hold:
            k = (gkey[o['group_key']]['name'].strip(), o['name'].strip(), src_max, hold)
            qty_hold[k] = qty_hold.get(k, 0) + 1
        option_rows.append({
            'id': uid('option', SOURCE_SYSTEM, source_store_id, o['source_menu_id'], o['source_group_id'], o['source_option_id']),
            'group_id': group_uuid[o['group_key']], 'name': o['name'].strip(), 'additional_price': price,
            'allow_quantity': allow, 'max_quantity': max_q, 'source_max_quantity': src_max,
            'sort_order': int(o['sort_order']), 'source_option_id': o['source_option_id'], 'group_key': o['group_key'],
            'source_menu_id': o['source_menu_id']})
    if any(o['allow_quantity'] and (o['max_quantity'] is None or o['max_quantity'] < 2) for o in option_rows):
        issues.append('수량 옵션의 상한은 2 이상이어야 한다')

    # ---- 기존 가상 옵션: 연결된 메뉴에 새 옵션이 생기면 기존 옵션·그룹은 비활성(삭제하지 않는다)
    new_group_menus = {g['menu_id'] for g in group_rows}
    link_ids = {r['id'] for r in menu_rows if r['kind'] == 'LINK'}
    planned_group_ids = {g['id'] for g in group_rows}
    deact_groups = [g for g in existing.get('groups', []) if g['menu_id'] in link_ids and g['menu_id'] in new_group_menus and g['id'] not in planned_group_ids]
    deact_group_ids = {g['id'] for g in deact_groups}
    deact_options = [o for o in existing.get('options', []) if o['group_id'] in deact_group_ids]
    # 새 옵션이 없는 연결 메뉴에 기존 옵션이 남아 있으면 알린다(실제 옵션이 없는 메뉴에 가상 옵션을 남기지 않는 것이 맞는지 확인용)
    for g in existing.get('groups', []):
        if g['menu_id'] in link_ids and g['menu_id'] not in new_group_menus and g['is_active']:
            notes.append(f'수집 자료에 옵션이 없는 연결 메뉴에 기존 옵션 그룹이 남는다: {ex_menus[g["menu_id"]]["name"]} / {g["name"]}')

    # ---- 사진: 정확히 대응되는 새 메뉴에만 올린다. 기존 메뉴의 사진은 유지한다
    photo_rows, seen_photo = [], set()
    kind_of = {r['id']: r['kind'] for r in menu_rows}
    skipped_existing_photo = []
    for p in photos:
        if p['source_menu_id'] not in menu_uuid:
            issues.append(f'사진의 메뉴가 없다: {p["source_menu_id"]}')
            continue
        if p['source_menu_id'] in seen_photo:
            issues.append(f'메뉴 하나에 사진이 둘 이상: {p["source_menu_id"]}')
            continue
        seen_photo.add(p['source_menu_id'])
        mid = menu_uuid[p['source_menu_id']]
        path = os.path.join(package, p['local_path'])
        if not os.path.exists(path):
            issues.append(f'사진 파일이 없다: {p["local_path"]}')
            continue
        data = open(path, 'rb').read()
        if hashlib.sha256(data).hexdigest() != p['sha256']:
            issues.append(f'사진 해시가 다르다: {p["local_path"]}')
        ext, mime = sniff_image(path)
        if ext is None:
            issues.append(f'png/jpeg가 아니다: {p["local_path"]}')
            continue
        if len(data) > MAX_IMAGE_BYTES:
            issues.append(f'사진이 2MiB를 넘는다: {p["local_path"]}')
        if kind_of[mid] == 'LINK':
            old = ex_menus[mid]
            skipped_existing_photo.append({'menu': old['name'], 'existing_image_ref': old['image_ref']})
            continue
        photo_rows.append({'menu_id': mid, 'object_path': f'menus/{mid}.{ext}', 'local_path': path, 'mime': mime, 'bytes': len(data),
                           'sha256': p['sha256'], 'source_url': p['source_url'], 'rights_status': p.get('rights_status', '미확인'), 'menu_name': p['menu_name']})
    with_photo = {r['menu_id']: r['object_path'] for r in photo_rows}
    for r in menu_rows:
        r['image_ref'] = with_photo.get(r['id']) if r['kind'] == 'NEW' else ex_menus[r['id']]['image_ref']
    missing = [r for r in menu_rows if r['kind'] == 'NEW' and r['image_ref'] is None]

    # ---- 내부 출처 기록 (권리·사용 허락 '미확인'. 공개 출처 목록은 만들지 않는다)
    records = []
    for r in menu_rows:
        status = f'원본 판매 상태: {r["source_sale_status"]}'
        if r['source_sale_status'] == '미확인':
            status += ' (원본 확인 못 함. 앱 노출 기본값: 판매 중으로 둠)'
        if r['kind'] == 'LINK':
            note = f'가격 갱신(쿠팡이츠 서대문 연희점 배달앱 가격 {r["base_price"]:,}원, 기존 {r["old_price"]:,}원). 가격 출처: {r["price_source"]}. {status}'
        else:
            note = f'새 메뉴. 가격 출처: {r["price_source"]}. {status}'
        records.append({'url': r['source_reference'], 'collected_for': 'MENU_PRICE', 'subject_label': r['name'], 'note': note})
        if r['kind'] == 'NEW' and r['description']:
            records.append({'url': r['source_reference'], 'collected_for': 'MENU_DESCRIPTION', 'subject_label': r['name'], 'note': '쿠팡이츠 앱 설명 원문, 권리 미확인'})
        if r['fills_description']:
            records.append({'url': r['source_reference'], 'collected_for': 'MENU_DESCRIPTION', 'subject_label': r['name'], 'note': '기존 설명이 비어 쿠팡이츠 설명으로 채움, 권리 미확인'})
    for r in photo_rows:
        records.append({'url': r['source_url'], 'collected_for': 'IMAGE_PAGE', 'subject_label': r['menu_name'], 'note': f'사진 원본 URL, 권리 상태 {r["rights_status"]}'})
    ref_of = {r['source_menu_id']: r['source_reference'] for r in menu_rows}
    qty_by_menu = {}
    for o in option_rows:
        if o['allow_quantity']:
            qty_by_menu.setdefault(o['source_menu_id'], []).append(o)
    for sid, os_ in qty_by_menu.items():
        records.append({'url': ref_of[sid], 'collected_for': 'OTHER', 'subject_label': f'옵션 수량 조절 {len(os_)}개',
                        'note': f'옵션 수량 허용 {len(os_)}행: 원본 그룹 SELECT_MULTI_QTY 소스 옵션(quantityChangeable 플래그 또는 소스 옵션 화면 확인). 원본 maxQuantity={sorted({o["source_max_quantity"] for o in os_})}를 그대로 앱 상한으로 사용(서정 결정 2026-11-18). 1000의 의미는 미확인'})
    if max_select_mode == 'options':
        per_menu = {}
        for g in group_rows:
            if g['source_max_select'] != g['max_select']:
                per_menu.setdefault(g['source_menu_id'], []).append(g)
        for sid, gs in per_menu.items():
            records.append({'url': ref_of[sid], 'collected_for': 'OTHER', 'subject_label': f'{len(gs)}개 그룹 선택 상한',
                            'note': f'원본 max_select={gs[0]["source_max_select"]}을 선택지 수로 표현({len(gs)}개 그룹). 최소 선택·선택지·추가금은 원본 그대로'})
    for g in deact_groups:
        records.append({'url': ref_of[next(r['source_menu_id'] for r in menu_rows if r['id'] == g['menu_id'])], 'collected_for': 'OTHER',
                        'subject_label': f'{ex_menus[g["menu_id"]]["name"]} / {g["name"]}',
                        'note': '기존 가상 옵션 그룹을 실제 옵션으로 교체하며 비활성 처리(삭제하지 않음, 과거 참조 보존)'})
    for rec in records:
        if not rec['url'] or not rec['url'].startswith(('http://', 'https://')):
            issues.append(f'출처 URL이 올바르지 않다: {rec["subject_label"]}')

    names = {}
    for r in menu_rows:
        names.setdefault(r['name'], []).append(r['source_menu_id'])
    for n, ids in names.items():
        if len(ids) > 1:
            notes.append(f'같은 이름의 메뉴가 둘 이상: {n} {ids}')

    return {
        'store': {'id': STORE_ID, 'name': STORE_NAME, 'source_store_id': source_store_id},
        'menus': menu_rows, 'groups': group_rows, 'options': option_rows, 'photos': photo_rows, 'records': records,
        'links': [{'existing_menu_id': l['existing_menu_id'], 'existing_name': l['existing_name'], 'source_menu_id': sid, 'source_name': l['source_name'],
                   'basis': l['basis'], 'evidence': l['evidence']} for sid, l in links.items()],
        'held': held, 'deact_groups': deact_groups, 'deact_options': deact_options, 'skipped_existing_photo': skipped_existing_photo,
        'missing_photo_menus': [{'source_menu_id': r['source_menu_id'], 'name': r['name']} for r in missing],
        'unknown_status_menus': [{'source_menu_id': r['source_menu_id'], 'name': r['name'], 'price': r['base_price'], 'alcohol': r['alcohol'], 'active': r['is_active']}
                                 for r in menu_rows if r['source_sale_status'] == '미확인'],
        'max_select_mode': max_select_mode, 'option_max_quantity': option_max_quantity,
        'quantity_hold': [{'group': k[0], 'option': k[1], 'source_max': k[2], 'reason': k[3], 'rows': n} for k, n in sorted(qty_hold.items())],
        'issues': issues, 'notes': notes,
    }


def id_map(plan):
    return {
        'namespace': str(NAMESPACE), 'batch': BATCH, 'source_system': SOURCE_SYSTEM,
        'store': {str(plan['store']['source_store_id']): plan['store']['id']},
        'menus': {str(r['source_menu_id']): r['id'] for r in plan['menus']},
        'menus_linked_to_existing': {str(l['source_menu_id']): l['existing_menu_id'] for l in plan['links']},
        'groups': {r['group_key']: r['id'] for r in plan['groups']},
        'options': {f"{r['group_key']}:{r['source_option_id']}": r['id'] for r in plan['options']},
    }


# ---------------------------------------------------------------- 검사 보고서
def render_report(plan, state):
    t = state.get('totals', {})
    existing = state
    existing_menu_ids = {m['id'] for m in existing.get('menus', [])}
    new_menus = [r for r in plan['menus'] if r['kind'] == 'NEW' and r['id'] not in existing_menu_ids]
    linked = [r for r in plan['menus'] if r['kind'] == 'LINK']
    price_changed = [r for r in linked if r['old_price'] != r['base_price']]
    existing_group_ids = {g['id'] for g in existing.get('groups', [])}
    existing_option_ids = {o['id'] for o in existing.get('options', [])}
    new_groups = [g for g in plan['groups'] if g['id'] not in existing_group_ids]
    new_options = [o for o in plan['options'] if o['id'] not in existing_option_ids]
    active_deact_g = [g for g in plan['deact_groups'] if g['is_active']]
    active_deact_o = [o for o in plan['deact_options'] if o['is_active']]
    L = []
    w = L.append
    w('# 굽네 기존 가게 확장 적용 전 검사 보고서')
    w('')
    w(f'- 대상 프로젝트: {state.get("project_name", "(미확인)")} / ref `{state.get("project_ref", "(미확인)")}`')
    w(f'- 개발용 근거: {state.get("dev_evidence", "(미확인 — 서정 확인 필요)")}')
    w(f'- 검사 시각: {datetime.datetime.now().isoformat(timespec="seconds")} / 상태 출처: {state.get("source", "?")}')
    w(f'- 대상 가게: `{STORE_NAME}` {STORE_ID} (UUID 유지, 이름·대표사진·영업/추천 상태는 바꾸지 않음)')
    w('')
    w('## 변경 요약')
    w('| 구분 | 추가 | 수정 | 비활성 | 삭제 |')
    w('|---|---|---|---|---|')
    w(f'| 가게 | 0 | 0 | 0 | 0 |')
    w(f'| 메뉴 | {len(new_menus)} | {len(price_changed)} (가격 갱신, 동일가 {len(linked) - len(price_changed)}) | 0 | 0 |')
    w(f'| 옵션 그룹 | {len(new_groups)} | 0 | {len(active_deact_g)} | 0 |')
    w(f'| 옵션 | {len(new_options)} | 0 | {len(active_deact_o)} | 0 |')
    w(f'| 내부 출처 기록(권리 미확인) | {len(plan["records"])} | 0 | 0 | 0 |')
    w(f'| 사진 업로드(새 경로) | {len(plan["photos"])} | 0 | 0 | 0 |')
    w(f'| 공개 출처 목록(store_sources) | 0 | 0 | 0 | 0 |')
    w('')
    w('## 적용 후 예상')
    if t:
        w(f'- 활성 가게 {t.get("stores_active")} → {t.get("stores_active")} (새 가게 없음)')
        w(f'- 활성 메뉴 {t.get("menus_active")} → {t.get("menus_active", 0) + sum(1 for r in new_menus if r["is_active"])}')
        w(f'- 옵션 그룹 {t.get("groups_total")} → {t.get("groups_total", 0) + len(new_groups)} (그 중 비활성 {len(active_deact_g)} 추가), 옵션 {t.get("options_total")} → {t.get("options_total", 0) + len(new_options)} (비활성 {len(active_deact_o)} 추가)')
    w('- 다른 가게 15곳·사용자·주문 스냅샷은 바꾸지 않는다. 이 가게의 주문 {} 건·리뷰 {} 건 연결과 스냅샷도 그대로.'.format(existing.get('refs', {}).get('orders', '?'), existing.get('refs', {}).get('review_menus', '?')))
    w('')
    w('## 기존 메뉴 ↔ 수집 메뉴 대응표')
    w('| 기존 메뉴 | 수집 메뉴 | 연결 근거 | 기존 가격 → 새 가격 |')
    w('|---|---|---|---|')
    for r in linked:
        l = next(x for x in plan['links'] if x['existing_menu_id'] == r['id'])
        w(f'| {r["name"]} | {l["source_name"]} | {"이름 동일(띄어쓰기 차이 포함)" if l["basis"] == "EXACT_NAME" else "표기만 다름(설명 대조)" if l["basis"] == "NOTATION" else "서정 확인"} | {r["old_price"]:,} → {r["base_price"]:,} |')
    for h in plan['held']:
        w(f'| **{h["existing_name"]}** | (후보: {h.get("candidate_name")}) | **연결 보류** — {h["evidence"]} | 변경 없음 |')
    w('')
    w('## 연결하지 않은 기존 메뉴')
    if plan['held']:
        for h in plan['held']:
            w(f'- {h["existing_name"]}: 임의 삭제·엉뚱한 연결 없이 그대로 둔다. 후보 "{h.get("candidate_name")}"는 새 메뉴로 추가된다.')
            w(f'  - 근거: {h["evidence"]}')
    else:
        w('- 없음')
    w('')
    w('## 옵션 교체')
    w(f'- 기존 가상 옵션 그룹 {len(plan["deact_groups"])}개·옵션 {len(plan["deact_options"])}개는 삭제하지 않고 비활성 처리한다(과거 참조 보존). 새 실제 옵션이 같은 메뉴에 추가돼 함께 노출되지 않는다.')
    for g in plan['deact_groups']:
        w(f'  - {next(r["name"] for r in plan["menus"] if r["id"] == g["menu_id"])} / {g["name"]}')
    on = [o for o in plan['options'] if o['allow_quantity']]
    w(f'- 수량 조절을 켜는 옵션: {len(on)}행(이름 {len({o["name"] for o in on})}종), 상한은 원본 maxQuantity({sorted({o["max_quantity"] for o in on})}) 그대로')
    w(f'- 수량 조절 보류(미확인, 켜지도 끄지도 않고 일반 옵션으로 둠): {sum(h["rows"] for h in plan["quantity_hold"])}행')
    for h in plan['quantity_hold']:
        w(f'  - [{h["group"]}] {h["option"]} (원본 max {h["source_max"]}) ×{h["rows"]}: {h["reason"]}')
    w('')
    w('## 사진')
    w(f'- 새 메뉴 사진 {len(plan["photos"])}장 업로드(전부 새 경로, 덮어쓰기 없음)')
    w(f'- 연결된 기존 메뉴 {len(plan["skipped_existing_photo"])}개는 수집 사진이 있어도 **기존 사진을 유지**한다(덮어쓰지 않음): ' + ', '.join(x['menu'] for x in plan['skipped_existing_photo']))
    w(f'- 사진 없는 새 메뉴 {len(plan["missing_photo_menus"])}개는 NULL(앱 기본 이미지). 다른 사진을 넣지 않는다. 가게 대표사진은 유지한다.')
    w('')
    w('## 가격 · 판매 상태')
    w('- 가격은 응답의 판매가(base_price_krw). 필수 옵션 포함가는 기본가와 같아 중복 합산이 없다. 할인·홍보 표시가격은 쓰지 않는다.')
    unk = plan['unknown_status_menus']
    w(f'- **원본 판매 상태를 확인하지 못한 메뉴 {len(unk)}개**(화면 가격 사용): 원본 상태는 내부 기록에 "미확인"으로 남기고, 앱 노출 기본값은 별도로 정한다.')
    w(f'  - 현재 앱 노출 기본값: 판매 중(is_active=true, is_sold_out=false) — 이것은 "판매 중 확인"이 아니다. 주류 {sum(1 for u in unk if u["alcohol"])}개 포함, 현재 비노출 {sum(1 for u in unk if not u["active"])}개')
    w('')
    w('## 옵션 그룹 선택 상한(max_select)')
    big = [g for g in plan['groups'] if g['source_max_select'] >= 1000]
    w(f'- 원본 max_select=1000인 그룹 {len(big)}개(선택지 수 {min(g["option_count"] for g in big)}~{max(g["option_count"] for g in big)}). 현재 방식: **{"원본 그대로" if plan["max_select_mode"] == "source" else "선택지 수로 표현"}**')
    w('')
    w('## 미결정 · 확인 필요')
    for n in plan['notes']:
        w(f'- {n}')
    if plan['issues']:
        w('')
        w('## 오류 (적용 불가)')
        for i in plan['issues']:
            w(f'- {i}')
    else:
        w('')
        w('## 변환 검사: 오류 없음')
    return '\n'.join(L) + '\n'


# ---------------------------------------------------------------- DB
def connect():
    url = os.environ.get('DATABASE_URL')
    if not url:
        sys.exit('DATABASE_URL이 필요합니다(Supabase 대시보드의 연결 문자열). 터미널 환경변수나 .env.import로 넣어 주세요. 값은 채팅에 적지 마세요.')
    try:
        import psycopg2
    except ImportError:
        sys.exit('psycopg2가 필요합니다: pip install psycopg2-binary')
    return psycopg2.connect(url)


def load_existing(cur):
    cur.execute(EXISTING_SQL, {'sid': STORE_ID})
    state = cur.fetchone()[0]
    state['source'] = 'database'
    return state


def order_fingerprint(cur):
    cur.execute(ORDER_FP_SQL, {'sid': STORE_ID})
    return cur.fetchone()[0]


def other_store_fingerprints(cur):
    cur.execute(FINGERPRINT_SQL, {'sid': STORE_ID})
    return {r[0]: r[1] for r in cur.fetchall()}


# ---------------------------------------------------------------- 사진 (Storage REST)
def storage_request(method, path, data=None, content_type=None):
    base = os.environ.get('SUPABASE_URL')
    key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not base or not key:
        sys.exit('사진 업로드에는 SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다(터미널 환경변수나 .env.import). 값은 채팅에 적지 마세요.')
    req = urllib.request.Request(base.rstrip('/') + path, data=data, method=method)
    req.add_header('Authorization', f'Bearer {key}')
    req.add_header('apikey', key)
    if content_type:
        req.add_header('Content-Type', content_type)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def public_url(path):
    return os.environ['SUPABASE_URL'].rstrip('/') + f'/storage/v1/object/public/{BUCKET}/{path}'


def upload_photos(plan):
    """새 경로에만 올린다. 이미 있으면 같은 파일일 때만 건너뛰고, 다르면 덮어쓰지 않고 실패로 센다."""
    done, failed = [], []
    for p in plan['photos']:
        with open(p['local_path'], 'rb') as f:
            data = f.read()
        status, body = storage_request('POST', f'/storage/v1/object/{BUCKET}/{p["object_path"]}', data, p['mime'])
        if status in (200, 201):
            done.append(p['object_path'])
            continue
        try:
            with urllib.request.urlopen(public_url(p['object_path']), timeout=60) as r:
                same = hashlib.sha256(r.read()).hexdigest() == p['sha256']
        except Exception:
            same = False
        if same:
            done.append(p['object_path'])
        else:
            failed.append((p['object_path'], status, body[:120].decode('utf-8', 'replace')))
    return done, failed


def delete_photos(plan):
    removed, failed = 0, []
    for p in plan['photos']:
        status, body = storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}')
        if status in (200, 204, 404):
            removed += 1
        else:
            failed.append((p['object_path'], status))
    return removed, failed


# ---------------------------------------------------------------- 반영 (한 트랜잭션, 재실행 안전)
def apply_db(cur, plan, uploaded):
    from psycopg2.extras import execute_values
    # 가게는 건드리지 않는다. 존재만 확인
    cur.execute('select 1 from public.stores where id = %s', (STORE_ID,))
    if not cur.fetchone():
        raise RuntimeError('기존 굽네치킨 가게가 없다')
    new = [m for m in plan['menus'] if m['kind'] == 'NEW']
    linked = [m for m in plan['menus'] if m['kind'] == 'LINK']
    execute_values(cur, """insert into public.menus (id, store_id, name, description, base_price, image_ref, sort_order, is_active, is_sold_out)
        values %s
        on conflict (id) do update set name = excluded.name, description = excluded.description, base_price = excluded.base_price,
          sort_order = excluded.sort_order, image_ref = coalesce(excluded.image_ref, public.menus.image_ref)""",
        [(m['id'], STORE_ID, m['name'], m['description'], m['base_price'], m['image_ref'] if m['image_ref'] in uploaded else None,
          m['sort_order'], m['is_active'], m['is_sold_out']) for m in new])
    # 기존 메뉴: 가격만 갱신(비어 있던 설명은 채움). 이름·사진·인기·추천·활성·품절은 그대로
    for m in linked:
        cur.execute("""update public.menus set base_price = %s, description = coalesce(description, %s) where id = %s and store_id = %s""",
                    (m['base_price'], m['description'], m['id'], STORE_ID))
        if cur.rowcount != 1:
            raise RuntimeError(f'기존 메뉴를 갱신하지 못했다: {m["name"]}')
    execute_values(cur, """insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order, is_active)
        values %s
        on conflict (id) do update set name = excluded.name, min_select = excluded.min_select, max_select = excluded.max_select,
          sort_order = excluded.sort_order""",
        [(g['id'], g['menu_id'], g['name'], g['min_select'], g['max_select'], g['sort_order'], True) for g in plan['groups']], page_size=500)
    execute_values(cur, """insert into public.menu_options (id, group_id, name, additional_price, allow_quantity, max_quantity, sort_order, is_active, is_sold_out)
        values %s
        on conflict (id) do update set name = excluded.name, additional_price = excluded.additional_price,
          allow_quantity = excluded.allow_quantity, max_quantity = excluded.max_quantity, sort_order = excluded.sort_order""",
        [(o['id'], o['group_id'], o['name'], o['additional_price'], o['allow_quantity'], o['max_quantity'], o['sort_order'], True, False) for o in plan['options']],
        page_size=500)
    # 기존 가상 옵션 비활성(삭제하지 않는다)
    if plan['deact_options']:
        cur.execute('update public.menu_options set is_active = false where id = any(%s::uuid[])', ([o['id'] for o in plan['deact_options']],))
    if plan['deact_groups']:
        cur.execute('update public.menu_option_groups set is_active = false where id = any(%s::uuid[])', ([g['id'] for g in plan['deact_groups']],))
    # 내부 출처 기록: 이 배치 것을 지우고 다시 넣어 재실행해도 중복이 없다
    cur.execute('delete from private.store_source_records where load_batch = %s and store_id = %s', (BATCH, STORE_ID))
    execute_values(cur, """insert into private.store_source_records
          (store_id, url, collected_for, subject_label, host_kind, rights_permission, reuse_permission, evidence, note, checked_on, load_batch)
        values %s""",
        [(STORE_ID, r['url'], r['collected_for'], r['subject_label'], 'PLATFORM', '미확인', '미확인',
          '쿠팡이츠 앱 수집(굽네치킨&피자 서대문 연희점, source_store_id=%s). 개발 서버 적용이며 외부 공개 승인이 아님' % plan['store']['source_store_id'],
          r['note'], '2026-11-17', BATCH) for r in plan['records']], page_size=500)


def restore_db(cur, plan, backup):
    """이번 적용분만 되돌린다. 새 행 삭제 → 기존 행의 가격·설명·활성 상태 복원. 주문·리뷰 참조가 있으면 멈춘다."""
    new_ids = [m['id'] for m in plan['menus'] if m['kind'] == 'NEW']
    cur.execute('select count(*) from public.order_items where menu_id = any(%s::uuid[])', (new_ids,))
    if cur.fetchone()[0]:
        raise RuntimeError('새 메뉴를 가리키는 주문이 있어 지울 수 없다')
    cur.execute('select count(*) from public.order_item_options where source_option_id = any(%s::uuid[])', ([o['id'] for o in plan['options']],))
    if cur.fetchone()[0]:
        raise RuntimeError('새 옵션을 가리키는 주문이 있어 지울 수 없다')
    cur.execute('delete from public.menu_options where id = any(%s::uuid[])', ([o['id'] for o in plan['options']],))
    cur.execute('delete from public.menu_option_groups where id = any(%s::uuid[])', ([g['id'] for g in plan['groups']],))
    cur.execute('delete from public.menus where id = any(%s::uuid[])', (new_ids,))
    cur.execute('delete from private.store_source_records where load_batch = %s and store_id = %s', (BATCH, STORE_ID))
    before = backup['existing']
    for m in before['menus']:
        cur.execute('update public.menus set base_price = %s, description = %s where id = %s', (m['base_price'], m['description'], m['id']))
    for g in before['groups']:
        cur.execute('update public.menu_option_groups set is_active = %s where id = %s', (g['is_active'], g['id']))
    for o in before['options']:
        cur.execute('update public.menu_options set is_active = %s where id = %s', (o['is_active'], o['id']))


# ---------------------------------------------------------------- 검증
def verify(plan, cur, before=None, photos_expected=True):
    results = []

    def check(name, ok, detail=''):
        results.append((name, bool(ok), detail))
        print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else f'  -> {detail}'))

    now = load_existing(cur)
    menus_db = {m['id']: m for m in now['menus']}
    groups_db = {g['id']: g for g in now['groups']}
    options_db = {o['id']: o for o in now['options']}
    new = [m for m in plan['menus'] if m['kind'] == 'NEW']
    linked = [m for m in plan['menus'] if m['kind'] == 'LINK']
    check('가게 UUID 유지', now['store'] and now['store']['id'] == STORE_ID)
    check('기존 메뉴 UUID 전부 유지', all(m['id'] in menus_db for m in linked) and all(h['existing_menu_id'] in menus_db for h in plan['held']))
    check('메뉴 가격 일치(연결+새)', all(menus_db.get(m['id'], {}).get('base_price') == m['base_price'] for m in plan['menus']))
    check('새 메뉴 수', all(m['id'] in menus_db for m in new) and len(menus_db) == len(plan['menus']) + len(plan['held']), f'{len(menus_db)}')
    want_ref = (lambda m: m['image_ref']) if photos_expected else (lambda m: ex_ref(m))

    def ex_ref(m):
        return None if m['kind'] == 'NEW' else m['image_ref']
    check('사진 연결(새 메뉴=새 경로 또는 NULL, 기존 메뉴=기존 사진 유지)' + ('' if photos_expected else ' [사진 건너뜀]'),
          all(menus_db.get(m['id'], {}).get('image_ref') == want_ref(m) for m in plan['menus']))
    check('가게 대표사진 유지', now['store']['image_ref'] is not None or before is None or now['store']['image_ref'] == before['existing']['store']['image_ref'])
    check('옵션 그룹 일치', all(groups_db.get(g['id'], {}).get('max_select') == g['max_select'] and groups_db[g['id']]['min_select'] == g['min_select'] and groups_db[g['id']]['is_active'] for g in plan['groups']))
    check('옵션 추가금·수량 설정 일치', all((options_db.get(o['id'], {}).get('additional_price'), options_db.get(o['id'], {}).get('allow_quantity'), options_db.get(o['id'], {}).get('max_quantity'))
                                    == (o['additional_price'], o['allow_quantity'], o['max_quantity']) and options_db[o['id']]['is_active'] for o in plan['options']))
    check('기존 가상 옵션 비활성(삭제 안 됨)', all(g['id'] in groups_db and not groups_db[g['id']]['is_active'] for g in plan['deact_groups'])
          and all(o['id'] in options_db and not options_db[o['id']]['is_active'] for o in plan['deact_options']))
    if before is not None:
        b = before['existing']
        bm = {m['id']: m for m in b['menus']}
        check('추천·인기 표시·품절·활성 보존', all(menus_db[i]['is_popular'] == m['is_popular'] and menus_db[i]['popularity_score'] == m['popularity_score']
                                         and menus_db[i]['is_sold_out'] == m['is_sold_out'] and menus_db[i]['is_active'] == m['is_active'] and menus_db[i]['name'] == m['name'] for i, m in bm.items()))
        check('주문·리뷰 스냅샷 해시 변경 없음', order_fingerprint(cur) == before['order_fingerprint'])
        check('다른 가게 변경 없음', other_store_fingerprints(cur) == before['other_store_fingerprints'])
        check('공개 출처 목록 변경 없음', now['refs']['store_sources'] == b['refs']['store_sources'])
    # 수량 옵션: 소스 2개 = 추가금 합, 메뉴 수량까지 반영 (읽기 전용 함수)
    sauce = [o for o in plan['options'] if o['allow_quantity']]
    for o in sauce[:3]:
        group = next(g for g in plan['groups'] if g['id'] == o['group_id'])
        menu = next(m for m in plan['menus'] if m['id'] == group['menu_id'])
        picked = [(o['id'], 2, o['additional_price'])]
        for g in plan['groups']:
            if g['menu_id'] == menu['id'] and g['min_select'] >= 1:
                opts = sorted((x for x in plan['options'] if x['group_id'] == g['id']), key=lambda x: (x['sort_order'], x['id']))[:g['min_select']]
                picked += [(x['id'], 1, x['additional_price']) for x in opts]
        picked.sort(key=lambda t: t[0])
        unit = menu['base_price'] + sum(price * qty for _, qty, price in picked)
        lines = [{'menuId': menu['id'], 'optionIds': [t[0] for t in picked], 'optionQuantities': [t[1] for t in picked], 'quantity': 2, 'approvedUnitPrice': unit}]
        cur.execute('select private.validate_order_catalog(%s::uuid, %s::jsonb, %s::bigint, false)', (STORE_ID, json.dumps(lines), unit * 2))
        snap = cur.fetchone()[0]
        sl = next(x for x in snap['lines'][0]['options'] if x['optionId'] == o['id'])
        check(f'소스 2개 추가금 {o["additional_price"] * 2:,}원 ({menu["name"]})', sl['quantity'] == 2 and sl['additionalPrice'] * sl['quantity'] == o['additional_price'] * 2, sl)
        check(f'(기본가+옵션 합)×메뉴 2개 ({unit:,}×2)', snap['total'] == unit * 2, snap['total'])
    fails = [r for r in results if not r[1]]
    print(f'{len(results) - len(fails)} / {len(results)} 통과')
    return not fails


def anon_verify(plan):
    """Guest(anon): get_menu 가 계획과 같고(비활성 가상 옵션은 안 보임) 사진이 실제로 받아지는지 본다. 공개 키만 쓴다."""
    base = os.environ.get('SUPABASE_URL') or os.environ.get('EXPO_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    if not base or not key:
        sys.exit('anon 검증에는 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY(공개 키)가 필요합니다.')
    gm, og = {}, {}
    for g in plan['groups']:
        gm.setdefault(g['menu_id'], []).append(g)
    for o in plan['options']:
        og.setdefault(o['group_id'], []).append(o)
    bad = []
    for m in plan['menus']:
        if not m['is_active']:
            continue
        req = urllib.request.Request(base.rstrip('/') + '/rest/v1/rpc/get_menu', data=json.dumps({'p_menu_id': m['id']}).encode(), method='POST')
        req.add_header('apikey', key)
        req.add_header('Content-Type', 'application/json')
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                dto = json.loads(r.read())
        except Exception as e:
            bad.append((m['name'], f'조회 실패 {e}'))
            continue
        if dto['price'] != m['base_price']:
            bad.append((m['name'], f'가격 {dto["price"]} != {m["base_price"]}'))
        want = {g['id']: sorted((o['id'], o['additional_price']) for o in og.get(g['id'], [])) for g in gm.get(m['id'], [])}
        got = {g['id']: sorted((o['id'], o['additionalPrice']) for o in g['options']) for g in dto['optionGroups']}
        if want != got:
            bad.append((m['name'], '옵션 그룹·선택지·추가금이 다름(가상 옵션이 함께 보이는 경우 포함)'))
        if {g['id']: (g['minSelect'], g['maxSelect']) for g in dto['optionGroups']} != {g['id']: (g['min_select'], g['max_select']) for g in gm.get(m['id'], [])}:
            bad.append((m['name'], '필수·최대 선택 제한이 다름'))
    print(f'anon get_menu: {sum(1 for m in plan["menus"] if m["is_active"]) - len(bad)} / {sum(1 for m in plan["menus"] if m["is_active"])} 일치')
    for b in bad[:10]:
        print('FAIL', b)
    photo_bad = []
    for p in plan['photos']:
        try:
            with urllib.request.urlopen(base.rstrip('/') + f'/storage/v1/object/public/{BUCKET}/{p["object_path"]}', timeout=30) as r:
                if hashlib.sha256(r.read()).hexdigest() != p['sha256']:
                    photo_bad.append(p['object_path'])
        except Exception:
            photo_bad.append(p['object_path'])
    print(f'anon 사진 조회: {len(plan["photos"]) - len(photo_bad)} / {len(plan["photos"])} 일치')
    return not bad and not photo_bad


# ---------------------------------------------------------------- 진입점
def main():
    load_env_file()
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--package', required=True, help='수집 자료 폴더(읽기 전용)')
    ap.add_argument('--option-max-quantity', type=int, default=OPTION_MAX_QUANTITY, help='수량 옵션 상한을 원본 maxQuantity 대신 이 값으로 줄인다(기본: 원본 값을 따름)')
    ap.add_argument('--max-select-mode', choices=('source', 'options'), default='source', help='원본 max_select=1000을 그대로(source) 또는 선택지 수로(options)')
    ap.add_argument('--confirm-link', action='append', default=[], help='보류된 기존 메뉴 UUID를 후보 수집 메뉴에 연결(서정 확인 후)')
    ap.add_argument('--no-option-quantity', action='store_true', help='옵션 수량 조절을 전부 끈다(기본은 quantity_rule에서 확인된 옵션만 켬)')
    ap.add_argument('--show-alcohol', action='store_true', help='주류 메뉴를 노출로 추가(기본은 숨김, 서정 결정 2026-11-18)')
    ap.add_argument('--snapshot', help='--check를 DB 없이 돌릴 때 쓰는 기존 상태 파일(JSON)')
    ap.add_argument('--skip-photos', action='store_true', help='사진 업로드를 건너뜀(로컬 시험용)')
    ap.add_argument('--yes-dev-project', action='store_true', help='연결 대상이 팀이 지정한 개발 프로젝트임을 확인했다')
    ap.add_argument('--backup-dir', help='--restore/--verify에 쓸 백업 폴더')
    mode = ap.add_mutually_exclusive_group(required=True)
    for name in ('check', 'backup', 'apply', 'verify', 'restore'):
        mode.add_argument(f'--{name}', action='store_true')
    args = ap.parse_args()
    opts = dict(option_max_quantity=args.option_max_quantity, max_select_mode=args.max_select_mode, confirm_links=tuple(args.confirm_link), hide_alcohol=not args.show_alcohol, enable_option_quantity=not args.no_option_quantity)
    out = os.path.join(HERE, 'out')

    if args.check:
        if args.snapshot:
            state = read_json(args.snapshot)
        else:
            conn = connect()
            with conn, conn.cursor() as cur:
                cur.execute('set transaction read only')
                state = load_existing(cur)
        plan = build_plan(args.package, state, **opts)
        write_json(os.path.join(HERE, 'id_map.json'), id_map(plan))
        report = render_report(plan, state)
        os.makedirs(out, exist_ok=True)
        with open(os.path.join(out, 'check_report.md'), 'w', encoding='utf-8') as f:
            f.write(report)
        print(report)
        return 1 if plan['issues'] else 0

    if not args.yes_dev_project and (args.backup or args.apply or args.restore):
        sys.exit('--yes-dev-project 가 필요합니다. 연결 대상이 팀이 지정한 개발 프로젝트임을 먼저 확인하세요.')
    conn = connect()
    with conn, conn.cursor() as cur:
        state = load_existing(cur)
        fps = other_store_fingerprints(cur)
        ofp = order_fingerprint(cur)
    plan = build_plan(args.package, state, **opts)
    if plan['issues']:
        print('변환·대응 검사에서 오류가 있어 진행하지 않습니다:')
        for i in plan['issues']:
            print(' -', i)
        return 1

    if args.backup or args.apply:
        # 백업은 절대 덮어쓰지 않는다(이름 충돌 시 실패). 이미 이 배치가 반영된 뒤의 상태는 '복구 기준'이 될 수 없어 표시해 둔다
        stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
        backup_dir = os.path.join(HERE, 'backup', stamp)
        os.makedirs(backup_dir, exist_ok=False)
        own_ids = set(id_map(plan)['menus'].values())
        already = any(m['id'] in own_ids and m['id'] not in {l['existing_menu_id'] for l in plan['links']} for m in state['menus'])
        if already:
            print('주의: 이미 이번 배치가 반영된 상태입니다. 이 백업은 적용 후 상태라서 --restore 기준으로 쓸 수 없습니다(원래 백업을 쓰세요).')
        write_json(os.path.join(backup_dir, 'before_state.json'), {'existing': state, 'other_store_fingerprints': fps, 'order_fingerprint': ofp, 'options': opts, 'already_applied': already})
        write_json(os.path.join(backup_dir, 'id_map.json'), id_map(plan))
        print(f'백업 저장: {backup_dir}')
        if args.backup:
            return 0
        uploaded = set()
        if not args.skip_photos:
            done, failed = upload_photos(plan)
            uploaded = set(done)
            print(f'사진 업로드: 성공 {len(done)} / 실패 {len(failed)}')
            if failed:
                for f in failed[:10]:
                    print('  실패', f)
                sys.exit('사진 업로드에 실패한 항목이 있어 DB 반영을 하지 않습니다. 같은 명령을 다시 실행하면 이어서 합니다.')
        conn = connect()
        try:
            with conn, conn.cursor() as cur:
                apply_db(cur, plan, uploaded)
        except Exception as e:
            print('DB 반영 실패(롤백됨):', e)
            return 1
        print('DB 반영 완료. 이어서 검증합니다.')
        conn = connect()
        with conn, conn.cursor() as cur:
            ok = verify(plan, cur, {'existing': state, 'other_store_fingerprints': fps, 'order_fingerprint': ofp}, not args.skip_photos)
        return 0 if ok else 1

    if args.verify:
        before = read_json(os.path.join(args.backup_dir, 'before_state.json')) if args.backup_dir else None
        conn = connect()
        with conn, conn.cursor() as cur:
            ok = verify(plan, cur, before, not args.skip_photos)
        if not args.skip_photos:
            ok = anon_verify(plan) and ok
        return 0 if ok else 1

    if args.restore:
        if not args.backup_dir:
            sys.exit('--backup-dir (백업 폴더)가 필요합니다.')
        backup = read_json(os.path.join(args.backup_dir, 'before_state.json'))
        if backup.get('already_applied'):
            sys.exit('이 백업은 이미 적용된 뒤의 상태라 복구 기준이 아닙니다. 적용 전에 만든 백업 폴더를 지정하세요.')
        conn = connect()
        with conn, conn.cursor() as cur:
            restore_db(cur, plan, backup)
        print('DB: 새 행을 지우고 기존 행의 가격·설명·옵션 활성 상태를 백업 값으로 되돌렸습니다.')
        if not args.skip_photos:
            removed, failed = delete_photos(plan)
            print(f'사진: {removed}개 삭제, 실패 {len(failed)}')
        return 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
