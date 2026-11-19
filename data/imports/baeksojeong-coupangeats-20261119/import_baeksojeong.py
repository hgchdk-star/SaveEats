#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
동대문엽기떡볶이(쿠팡이츠 홍제점) 수집본을 '기존 동대문엽기떡볶이 가게'에 확장 적용하는 도구 (개발 서버 전용).
굽네 도구(import_goobne.py)의 비밀값 마스킹·연결·Storage 보조 함수를 가져다 쓰고, 엽떡 전용 계획·적용·검증·복구를 따로 둔다.
굽네 전용 값(가게 UUID, 주류 규칙, 수량 근거 파일 등)은 쓰지 않는다.

  --check    읽기 전용. 대응표·추가/수정/삭제 개수·미결정 항목을 보고서(out/check_report.md)로 만든다
  --backup   적용 전 상태(가게의 메뉴·옵션 그룹·옵션 원본 행, 기존 사진 파일, 주문 스냅샷 해시, 다른 가게 해시)를 backup/<시각>/에 저장
  --apply    백업 → 사진 업로드 → DB 반영(한 트랜잭션, 안에서 검증) → Guest 검증
  --verify   적용 결과를 관리자·Guest(anon) 권한으로 대조
  --restore  백업 기준으로 되돌린다

정책 (서정 결정 2026-11-19):
  - 이 지점(홍제점)의 수집 가격을 기존 동대문엽기떡볶이의 대표값으로 쓴다. 전국 공통가로 확인됐다고 표현하지 않는다.
  - 가게·기존 메뉴 UUID, 주문·리뷰 참조와 스냅샷, 추천·인기, 가게 대표사진은 바꾸지 않는다.
  - 설명·사진의 출처·권리 상태는 내부 기록(private.store_source_records)에 '미확인'으로 남긴다. 개발 서버 적용은 외부 공개 승인이 아니다.
  - 원본 숫자 ID는 UUID가 아니다(UUIDv5 + id_map.json). 재실행해도 중복이 생기지 않는다.
  - 접속 정보는 환경변수나 .env.import(저장소 제외)로만 읽고 출력하지 않는다.
"""
import argparse
import datetime
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), 'goobne-coupangeats-20261117'))
import import_goobne as G  # noqa: E402  (마스킹·연결·Storage 보조 함수만 쓴다)

redact, safe_error, read_json, write_json, sniff_image = G.redact, G.safe_error, G.read_json, G.write_json, G.sniff_image

DEV_REF = 'msiahbzzebgjsoanjbtx'
STORE_ID = '80b4c10d-a815-51d9-add1-e10cc962cf37'  # 기존 백소정. UUID 유지
STORE_NAME = '백소정'
SOURCE_SYSTEM = 'coupangeats'
BATCH = 'baeksojeong-coupangeats-20261119'
BUCKET = G.BUCKET
MAX_IMAGE_BYTES = G.MAX_IMAGE_BYTES
SORT_STEP = 10
BACKUP_ROOT = os.environ.get('BAEK_BACKUP_ROOT') or os.path.join(HERE, 'backup')
G.BUCKET = BUCKET


def uid(*parts):
    return G.uid(*parts)


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


# ---------------------------------------------------------------- 현재 상태 읽기
GROUPS_SQL = """
select jsonb_build_object(
 'menu_groups', coalesce((select jsonb_agg(to_jsonb(g) order by g.sort_order) from public.store_menu_groups g where g.store_id = %(sid)s::uuid), '[]'::jsonb),
 'menu_group_items', coalesce((select jsonb_agg(to_jsonb(i) order by i.group_id, i.sort_order) from public.store_menu_group_items i where i.store_id = %(sid)s::uuid), '[]'::jsonb),
 'snapshot_option_ids', coalesce((select jsonb_agg(distinct oio.source_option_id) from public.order_item_options oio
        join public.order_items oi on oi.id = oio.order_item_id where oi.store_id = %(sid)s::uuid and oio.source_option_id is not null), '[]'::jsonb),
 'snapshot_group_ids', coalesce((select jsonb_agg(distinct oio.source_group_id) from public.order_item_options oio
        join public.order_items oi on oi.id = oio.order_item_id where oi.store_id = %(sid)s::uuid and oio.source_group_id is not null), '[]'::jsonb),
 'private_records', (select count(*) from private.store_source_records where store_id = %(sid)s::uuid and load_batch = %(batch)s)
)
"""


def load_existing(cur):
    cur.execute(G.EXISTING_SQL, {'sid': STORE_ID})
    state = cur.fetchone()[0]
    cur.execute(GROUPS_SQL, {'sid': STORE_ID, 'batch': BATCH})
    state.update(cur.fetchone()[0])
    state['source'] = 'database'
    return state


def order_fingerprint(cur):
    cur.execute(G.ORDER_FP_SQL, {'sid': STORE_ID})
    return cur.fetchone()[0]


def other_store_fingerprints(cur):
    cur.execute(G.FINGERPRINT_SQL, {'sid': STORE_ID})
    return {r[0]: r[1] for r in cur.fetchall()}


def fk_refs(cur, table, ids, ignore=()):
    """table(id)를 가리키는 모든 FK(다른 테이블의 어떤 열이든)에서 ids를 가리키는 행 수. ignore에 든 테이블은 함께 지울 것이라 센다."""
    if not ids:
        return {}
    cur.execute("""select c.conrelid::regclass::text, a.attname from pg_constraint c
                   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any(c.conkey)
                   where c.contype = 'f' and c.confrelid = %s::regclass""", (table,))
    out = {}
    for rel, col in cur.fetchall():
        if rel.split('.')[-1] in ignore:
            continue
        cur.execute(f'select count(*) from {rel} where "{col}" = any(%s::uuid[])', (ids,))
        n = cur.fetchone()[0]
        if n:
            out[f'{rel}.{col}'] = n
    return out


# 주문 스냅샷(order_item_options.source_option_id/source_group_id)은 FK 없이 원본 ID만 담는다. 가상 옵션·그룹을 지워도 스냅샷 행은 남는다.
# 아래 기대값은 굽네 때 확인한 의존성과 같다. 하나라도 다르면 참조된 옵션·그룹은 삭제하지 않고 비활성으로 보존한다.
EXPECTED_FKS = {('menu_options', 'menu_options_group_id_fkey', 'menu_option_groups', 'r')}
EXPECTED_SRC_FUNCS = {'public.create_order'}
EXPECTED_TRIGGERS = {('menu_options', 'menu_options_bump_menu_revision'), ('menu_option_groups', 'menu_option_groups_bump_menu_revision')}


def snapshot_preflight(cur):
    """라이브 DB에서 FK·조회 의존성을 다시 확인한다. 문제 목록을 돌려준다(비어 있으면 스냅샷이 가리키는 가상 옵션도 삭제해도 된다)."""
    problems = []
    cur.execute("""select conrelid::regclass::text, conname, confrelid::regclass::text, confdeltype::text
                   from pg_constraint where contype = 'f' and confrelid in ('public.menu_options'::regclass, 'public.menu_option_groups'::regclass)""")
    fks = {tuple(r) for r in cur.fetchall()}
    if fks != EXPECTED_FKS:
        problems.append(f'가상 옵션·그룹을 가리키는 FK가 예상과 다르다: {sorted(fks)}')
    cur.execute("""select n.nspname || '.' || p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('public', 'private') and (p.prosrc ilike '%source_option_id%' or p.prosrc ilike '%source_group_id%')""")
    funcs = {r[0] for r in cur.fetchall()}
    if funcs != EXPECTED_SRC_FUNCS:
        problems.append(f'원본 옵션·그룹 id를 쓰는 함수가 예상과 다르다: {sorted(funcs)}')
    cur.execute("""select count(*) from pg_views where definition ilike '%order_item_options%' or definition ilike '%source_option_id%' or definition ilike '%menu_options%'""")
    if cur.fetchone()[0]:
        problems.append('가상 옵션·주문 옵션 스냅샷을 쓰는 뷰가 있다')
    cur.execute("""select c.relname, t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
                   where not t.tgisinternal and c.relname in ('menu_options', 'menu_option_groups', 'order_item_options')""")
    trg = {tuple(r) for r in cur.fetchall()}
    if trg != EXPECTED_TRIGGERS:
        problems.append(f'옵션·그룹·주문 옵션 테이블의 트리거가 예상과 다르다: {sorted(trg)}')
    cur.execute("select count(*) from public.order_item_options oio left join public.order_items oi on oi.id = oio.order_item_id where oi.id is null")
    if cur.fetchone()[0]:
        problems.append('주문 항목이 없는 주문 옵션 스냅샷 행이 있다')
    return problems


# ---------------------------------------------------------------- 계획 (DB를 읽지 않고 existing 상태만 쓴다)
def build_plan(package, existing, option_max_quantity=None, sold_out_mode=None, enable_option_quantity=True, delete_referenced=False,
               menu_refs=None, group_names=None, none_mode=None, review_mode=None, total_mode=None):
    menus_src = read_json(os.path.join(package, 'menus.json'))
    groups_src = read_json(os.path.join(package, 'menu_option_groups.json'))
    options_src = read_json(os.path.join(package, 'menu_options.json'))
    photos_src = read_json(os.path.join(package, 'photo_index.json'))
    mg_src = read_json(os.path.join(package, 'menu_groups.json'))
    report = read_json(os.path.join(package, 'collection_report.json'))
    mapping = read_json(os.path.join(HERE, 'menu_mapping.json'))
    policy = read_json(os.path.join(HERE, 'option_policy.json'))
    issues, notes = [], []

    store_ids = {m['source_store_id'] for m in menus_src}
    if len(store_ids) != 1:
        issues.append(f'수집 가게가 하나가 아니다: {sorted(store_ids)}')
    source_store_id = sorted(store_ids)[0]
    if not existing.get('store') or existing['store']['id'] != STORE_ID:
        issues.append('기존 백소정 가게를 찾지 못했다')
    ex_menus = {m['id']: m for m in existing.get('menus', [])}

    # ---- 수집 자료 자체 검사
    for key, want, got in (('메뉴', report['menus'], len(menus_src)), ('옵션 그룹 연결', report['option_group_links'], len(groups_src)),
                           ('옵션 연결', report['option_links'], len(options_src)), ('메뉴 그룹', report['menu_groups'], len(mg_src)),
                           ('사진', report['downloaded_menu_photos'], len({p['source_menu_id'] for p in photos_src if p['status'] == 'downloaded'}))):
        if want != got:
            issues.append(f'수집 보고서와 자료의 개수가 다르다: {key} {want} / {got}')
    if len({m['source_menu_id'] for m in menus_src}) != len(menus_src):
        issues.append('메뉴 원본 ID 중복')

    # ---- 대응표
    links, removals = {}, []
    for ln in mapping['links']:
        old = ex_menus.get(ln['existing_menu_id'])
        if old is None:
            issues.append(f'대응표의 기존 메뉴가 서버에 없다: {ln["existing_name"]}')
            continue
        if old['name'] != ln['existing_name'] and not (ln.get('rename_to_source') and old['name'] == ln['source_name']):   # 이미 수집본 이름으로 맞춘 뒤 다시 돌려도 된다
            issues.append(f'기존 메뉴 이름이 대응표와 다르다: {ln["existing_name"]} / {old["name"]}')
        if ln['source_menu_id'] in links:
            issues.append(f'수집 메뉴가 두 기존 메뉴에 연결됨: {ln["source_menu_id"]}')
        links[ln['source_menu_id']] = ln
    for rm in mapping['remove']:
        if rm['existing_menu_id'] in ex_menus:
            if ex_menus[rm['existing_menu_id']]['name'] != rm['existing_name']:
                issues.append(f'삭제 대상 이름이 대응표와 다르다: {rm["existing_name"]}')
            rm = dict(rm)
            rm['refs'] = (menu_refs or {}).get(rm['existing_menu_id'], {})
            # 주문·리뷰 등이 가리키는 메뉴는 지울 수 없다(FK RESTRICT, 스냅샷 보존). 숨김(비활성)으로 보존한다
            rm['action'] = 'DEACTIVATE' if rm['refs'] else 'DELETE'
            removals.append(rm)
    own_new = {uid('menu', SOURCE_SYSTEM, source_store_id, m['source_menu_id']) for m in menus_src}
    mapped_existing = {l['existing_menu_id'] for l in links.values()} | {r['existing_menu_id'] for r in mapping['remove']}
    unmapped_existing = [m for m in existing.get('menus', []) if m['id'] not in mapped_existing and m['id'] not in own_new]
    for m in unmapped_existing:
        issues.append(f'대응표에 없는 기존 메뉴: {m["name"]}')

    # ---- 메뉴 그룹 순서 → 메뉴 sort_order (기존/신규 구분 없음)
    flat, gmap, memberships = [], {}, 0
    for gi, g in enumerate(sorted(mg_src, key=lambda x: x['sort_order'])):
        if len(g['menu_ids']) != len(set(g['menu_ids'])):
            issues.append(f'같은 그룹 안에 메뉴가 중복됐다: {g["name"]}')
        for mid in g['menu_ids']:
            memberships += 1
            if mid not in gmap:   # 여러 그룹에 속한 메뉴는 첫 소속 순서로 정렬하고, 그룹 연결만 늘린다(본체 복제 없음)
                gmap[mid] = gi
                flat.append(mid)
    src_menu_ids = [m['source_menu_id'] for m in menus_src]
    for mid in src_menu_ids:
        if mid not in gmap:
            issues.append(f'그룹에 속하지 않은 수집 메뉴: {mid}')
    for mid in flat:
        if mid not in set(src_menu_ids):
            issues.append(f'그룹 자료의 메뉴가 메뉴 자료에 없다: {mid}')
    order_of = {mid: SORT_STEP * (i + 1) for i, mid in enumerate(flat)}

    # ---- 메뉴
    by_id = {m['source_menu_id']: m for m in menus_src}
    menu_rows, menu_uuid = [], {}
    for sid in flat:
        m = by_id.get(sid)
        if m is None:
            continue
        price = m['base_price_krw']
        if not isinstance(price, int) or price < 0:
            issues.append(f'메뉴 가격이 올바르지 않다: {sid} {m["name"]}')
        if not (m['name'] or '').strip():
            issues.append(f'메뉴 이름이 비었다: {sid}')
        desc = (m.get('description') or '').strip() or None
        link = links.get(sid)
        sold = sold_out_mode == 'source' and m.get('sale_status') == 'SOLD_OUT_TODAY'
        if link:
            old = ex_menus[link['existing_menu_id']]
            row = {'kind': 'LINK', 'id': old['id'], 'name': (m['name'].strip() if link.get('rename_to_source') else old['name']), 'old_name': old['name'], 'old_price': old['base_price'], 'old_description': old['description'],
                   'description': old['description'] or desc, 'fills_description': old['description'] is None and desc is not None,
                   'is_active': old['is_active'], 'is_sold_out': old['is_sold_out'], 'old_sort_order': old['sort_order']}
        else:
            row = {'kind': 'NEW', 'id': uid('menu', SOURCE_SYSTEM, source_store_id, sid), 'name': m['name'].strip(), 'old_price': None,
                   'old_description': None, 'description': desc, 'fills_description': False, 'is_active': True, 'is_sold_out': sold, 'old_sort_order': None}
        row.update({'store_id': STORE_ID, 'base_price': price, 'source_menu_id': sid, 'source_name': m['name'].strip(), 'sort_order': order_of[sid],
                    'source_sale_status': m.get('sale_status') or '미확인', 'group_index': gmap.get(sid)})
        menu_uuid[sid] = row['id']
        menu_rows.append(row)
    if sold_out_mode == 'source':
        for r in menu_rows:
            if r['kind'] == 'LINK' and r['source_sale_status'] == 'SOLD_OUT_TODAY':
                notes.append(f'연결 메뉴가 원본에서 품절이지만 기존 품절 상태를 그대로 둔다: {r["name"]}')

    # ---- 옵션 그룹
    gkey = {g['group_key']: g for g in groups_src}
    n_opts = {}
    for o in options_src:
        n_opts[o['group_key']] = n_opts.get(o['group_key'], 0) + 1
    group_rows, group_uuid = [], {}
    for g in groups_src:
        if g['source_menu_id'] not in menu_uuid:
            issues.append(f'그룹의 메뉴가 없다: {g["group_key"]}')
            continue
        if g['group_key'] in group_uuid:
            issues.append(f'그룹 키 중복: {g["group_key"]}')
        name = (g['name'] or '').strip()
        if not name:
            issues.append(f'그룹 이름이 비었다: {g["group_key"]}')
        if not (0 <= g['min_select'] <= g['max_select'] and g['max_select'] >= 1):
            issues.append(f'그룹 선택 수가 올바르지 않다: {g["group_key"]}')
        if g['required_option'] != (g['min_select'] >= 1):
            issues.append(f'필수 표시와 min_select가 다르다: {g["group_key"]}')
        if g.get('default_option_id') is not None:
            notes.append(f'원본 기본 선택값이 있는 그룹(자동 선택하지 않는다): {g["group_key"]}')
        if review_mode == 'hidden' and g['source_group_id'] in policy['review_event_source_group_ids'] and g['min_select'] >= 1:
            issues.append(f'숨기려는 리뷰이벤트 그룹이 필수 선택이다(숨기면 담기가 불가능해진다): {g["group_key"]}')
        gid = uid('group', SOURCE_SYSTEM, source_store_id, g['source_menu_id'], g['source_group_id'])
        group_uuid[g['group_key']] = gid
        group_rows.append({'id': gid, 'menu_id': menu_uuid[g['source_menu_id']], 'name': name, 'min_select': g['min_select'], 'max_select': g['max_select'],
                           # 수량 합계 상한: 결정 플래그(--group-total-mode source-max)가 있을 때만. 근거와 영향은 보고서에 있다(원본 값은 별도 보존)
                           'max_total_quantity': (g['max_select'] if (total_mode == 'source-max' and g['source_type'] == 'SELECT_MULTI_QTY' and g['max_select'] < 1000) else None),
                           'is_active': not (review_mode == 'hidden' and g['source_group_id'] in policy['review_event_source_group_ids']),
                           'source_max_select': g['max_select'], 'option_count': n_opts.get(g['group_key'], 0), 'sort_order': int(g['sort_order']), 'group_key': g['group_key'],
                           'source_type': g['source_type'], 'source_menu_id': g['source_menu_id'], 'source_group_id': g['source_group_id']})
        if g['required_option'] and n_opts.get(g['group_key'], 0) < g['min_select']:
            issues.append(f'필수 그룹의 선택지가 부족하다: {g["group_key"]}')

    # ---- 옵션 (수량 허용은 원본 선택지별 quantity_changeable, 상한은 앱 정책값으로 제한)
    option_rows, seen = [], set()
    limited_groups = {}
    for o in options_src:
        if o['group_key'] not in group_uuid:
            issues.append(f'옵션의 그룹이 없다: {o["group_key"]}')
            continue
        key = (o['group_key'], o['source_option_id'])
        if key in seen:
            issues.append(f'옵션 키 중복: {key}')
        seen.add(key)
        price = o['additional_price_krw']
        if not isinstance(price, int) or price < 0:
            issues.append(f'옵션 추가금이 올바르지 않다: {key}')
        if not (o['name'] or '').strip():
            issues.append(f'옵션 이름이 비었다: {key}')
        if o['quantity_changeable'] and o['min_quantity'] != 1:   # 수량을 바꿀 수 없는 선택지의 원본 범위(예: 0~6)는 앱에 쓰지 않는다
            issues.append(f'옵션 최소 수량이 1이 아니다: {key}')
        g = gkey[o['group_key']]
        allow = bool(o['quantity_changeable']) and enable_option_quantity
        is_excl = none_mode == 'exclusive' and o['source_option_id'] in policy['none_option_source_ids']
        if is_excl:
            allow = False   # 단독 옵션은 수량 조절이 없다(서정 결정 2026-11-19, SaveEats 제품 결정이며 쿠팡이츠 확인 사실이 아님). 이름이 아니라 option_policy.json의 원본 ID로만 지정한다
        if none_mode == 'no-quantity' and o['source_option_id'] in policy['none_option_source_ids']:
            allow = False   # 원본 수량 변경 플래그를 쓰지 않고 1개 고정(서정 결정 시). 이름이 아니라 option_policy.json의 원본 ID로만 지정한다
        if o['quantity_changeable'] and g['source_type'] != 'SELECT_MULTI_QTY':
            issues.append(f'수량 변경 옵션이 수량형 그룹이 아니다: {key}')
        if not o['quantity_changeable'] and g['source_type'] == 'SELECT_MULTI_QTY':
            notes.append(f'수량형 그룹인데 수량 변경이 꺼진 옵션: {o["name"]}')
        max_q = None
        # 그룹 최대가 1000 미만인 수량형 그룹(음료 '최대 2개 가능'): 원본 값은 그대로 보존하고, SaveEats는 서정 제품 결정에 따라 수량 '합계' 상한으로 적용한다(아래 max_total_quantity)
        if allow and g['source_type'] == 'SELECT_MULTI_QTY' and g['max_select'] < 1000:
            limited_groups.setdefault((g['name'].strip(), g['max_select'], o['max_quantity']), 0)
            limited_groups[(g['name'].strip(), g['max_select'], o['max_quantity'])] += 1
        if allow and option_max_quantity:
            max_q = min(o['max_quantity'], option_max_quantity)
        option_rows.append({'id': uid('option', SOURCE_SYSTEM, source_store_id, g['source_menu_id'], g['source_group_id'], o['source_option_id']),
                            'group_id': group_uuid[o['group_key']], 'name': o['name'].strip(), 'additional_price': price, 'allow_quantity': allow,
                            'max_quantity': max_q, 'source_max_quantity': o['max_quantity'], 'sort_order': int(o['sort_order']), 'is_exclusive': is_excl,
                            'source_option_id': o['source_option_id'], 'group_key': o['group_key'], 'source_menu_id': g['source_menu_id'],
                            'source_group_id': g['source_group_id']})
    undecided = []
    if limited_groups and total_mode is None:
        undecided.append('필수 수량형 그룹 "최소 1개 ~ 8개"의 수량 합계 상한 적용(--group-total-mode none|source-max): ' + ', '.join(f'{k[0]} 그룹 최대 {k[1]}·옵션당 최대 {k[2]} {v}행' for k, v in sorted(limited_groups.items())))
    if none_mode is None and any(o['source_option_id'] in policy['none_option_source_ids'] for o in options_src):
        undecided.append('"선택안함" 옵션의 수량 조절 처리(--none-option-mode source|no-quantity)')
    if review_mode is None and any(g['source_group_id'] in policy['review_event_source_group_ids'] for g in groups_src):
        undecided.append('쿠팡이츠 "리뷰이벤트" 옵션 그룹 54개의 노출(--review-event-groups import|hidden)')
    if False:
        undecided.append('음료 "최대 N개 가능" 수량형 그룹의 제한 해석(--drink-limit-mode source|conservative): ' + ', '.join(f'{k[0]} 최대 {k[1]}·옵션당 최대 {k[2]} {v}행' for k, v in sorted(limited_groups.items())))
    if sold_out_mode is None and any(m.get('sale_status') == 'SOLD_OUT_TODAY' for m in menus_src):
        undecided.append('수집 당시 "오늘 품절" 메뉴의 앱 반영 여부(--sold-out-mode ignore|source)')
    nq = sum(1 for o in option_rows if o['allow_quantity'])
    if nq and not option_max_quantity:
        undecided.append(f'수량 조절 옵션 {nq}개의 앱 허용 상한(max_quantity). 원본 1000은 쓰지 않는다')
    if any(o['allow_quantity'] and o['max_quantity'] is not None and o['max_quantity'] < 2 for o in option_rows):
        issues.append('수량 옵션의 상한은 2 이상이어야 한다')

    # ---- 기존 가상 옵션·그룹: 연결 메뉴(+삭제 메뉴)의 기존 행. 참조가 없으면 삭제, 주문 스냅샷이 가리키면 비활성으로 보존
    planned_g = {g['id'] for g in group_rows}
    planned_o = {o['id'] for o in option_rows}
    link_ids = {r['id'] for r in menu_rows if r['kind'] == 'LINK'}
    rm_ids = {r['existing_menu_id'] for r in removals if r['action'] == 'DELETE'}
    snap_o, snap_g = set(existing.get('snapshot_option_ids', [])), set(existing.get('snapshot_group_ids', []))
    virt_groups = [g for g in existing.get('groups', []) if g['menu_id'] in (link_ids | rm_ids) and g['id'] not in planned_g]
    virt_group_ids = {g['id'] for g in virt_groups}
    virt_options = [o for o in existing.get('options', []) if o['group_id'] in virt_group_ids and o['id'] not in planned_o]
    referenced_groups = {g['id'] for g in virt_groups if g['id'] in snap_g or any(o['group_id'] == g['id'] and o['id'] in snap_o for o in virt_options)}
    # 서정 승인: 주문·리뷰·스냅샷을 보존하는 범위에서 의존성 점검을 통과하면 스냅샷이 가리키는 가상 옵션도 삭제한다(원본 ID 대응은 백업에 남긴다)
    # 승인한 것은 보고한 그룹(엽기메뉴 '맵기 선택')뿐이다. 그 뒤 새 주문이 가리키게 된 다른 가상 옵션은 보고와 다르므로 삭제하지 않고 비활성으로 보존한다
    approved = set(mapping.get('approved_snapshot_referenced_group_ids', []))
    keep_groups = referenced_groups if not delete_referenced else {g for g in referenced_groups if g not in approved}
    # 삭제 메뉴의 가상 옵션은 스냅샷이 가리키면 삭제 자체가 불가(메뉴 삭제도 멈춘다)
    for r in [x for x in removals if x['action'] == 'DELETE']:
        if any(g['menu_id'] == r['existing_menu_id'] and g['id'] in referenced_groups for g in virt_groups):
            issues.append(f'삭제 대상 메뉴의 옵션을 주문 스냅샷이 가리킨다: {r["existing_name"]}')
    virt_del_groups = [g for g in virt_groups if g['id'] not in keep_groups]
    virt_del_options = [o for o in virt_options if o['group_id'] not in keep_groups]
    virt_keep_groups = [g for g in virt_groups if g['id'] in keep_groups]
    virt_keep_options = [o for o in virt_options if o['group_id'] in keep_groups]
    snapshot_referenced_groups = [g for g in virt_groups if g['id'] in referenced_groups and g['id'] not in keep_groups]
    snapshot_referenced_options = [o for o in virt_options if o['group_id'] in referenced_groups and o['group_id'] not in keep_groups]

    # ---- 메뉴 그룹(앱 표시)
    mgroups, mitems = [], []
    display = {k: v for k, v in read_json(os.path.join(HERE, 'menu_group_display.json')).items() if not k.startswith('_')}
    for gi, g in enumerate(sorted(mg_src, key=lambda x: x['sort_order'])):
        gid = uid('menu-group', SOURCE_SYSTEM, source_store_id, g['source_group_id'])
        src_name = g['name'].strip()
        name = src_name
        prop = display.get(str(g['source_group_id']))
        if prop and group_names == 'proposed':
            name = prop['display_name']
        if prop and group_names is None:
            undecided.append(f'메뉴 그룹 표시명 제안 확인(--group-names source|proposed): "{src_name}" → "{prop["display_name"]}"')
        if len(name) > 60 or not name:
            issues.append(f'그룹 이름이 올바르지 않다: {name}')
        mgroups.append({'id': gid, 'name': name, 'source_name': src_name, 'sort_order': gi, 'source_group_id': g['source_group_id'],
                        'menu_count': len(g['menu_ids']), 'expose_status': g.get('expose_status')})
        for pos, mid in enumerate(g['menu_ids']):
            if mid in menu_uuid:
                mitems.append({'group_id': gid, 'menu_id': menu_uuid[mid], 'sort_order': pos, 'source_menu_id': mid, 'name': by_id[mid]['name']})
    if len(mitems) != memberships or len({i['menu_id'] for i in mitems}) != len(menus_src):
        issues.append(f'그룹 소속 수({len(mitems)}/{memberships})나 고유 메뉴 수({len({i["menu_id"] for i in mitems})}/{len(menus_src)})가 다르다')
    if memberships != report.get('menu_group_memberships', memberships):
        issues.append(f'수집 보고서의 그룹 소속 수가 다르다: {report.get("menu_group_memberships")} / {memberships}')

    # ---- 사진: 연결(기존 UUID) 메뉴는 기존 사진 유지, 새 메뉴만 업로드
    photo_rows, seen_p, kept, seen_sha, dup_photo_records = [], set(), [], {}, 0
    kind_of = {r['id']: r['kind'] for r in menu_rows}
    for p in photos_src:
        if p['status'] != 'downloaded':
            continue
        if p['source_menu_id'] not in menu_uuid:
            issues.append(f'사진의 메뉴가 없다: {p["source_menu_id"]}')
            continue
        if p['source_menu_id'] in seen_p:
            if p['sha256'] != seen_sha[p['source_menu_id']]:
                issues.append(f'메뉴 하나에 서로 다른 사진이 둘 이상: {p["source_menu_id"]}')
            else:
                dup_photo_records += 1   # 같은 URL·같은 파일을 두 번 기록한 것(대표 사진을 고를 필요가 없다)
            continue
        seen_sha[p['source_menu_id']] = p['sha256']
        seen_p.add(p['source_menu_id'])
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
            kept.append({'menu': ex_menus[mid]['name'], 'existing_image_ref': ex_menus[mid]['image_ref'], 'collected_sha256': p['sha256'], 'collected_bytes': len(data)})
            continue
        photo_rows.append({'menu_id': mid, 'object_path': f'menus/{mid}.{ext}', 'local_path': path, 'mime': mime, 'bytes': len(data), 'sha256': p['sha256'],
                           'source_url': p['source_url'], 'rights_status': p.get('rights_status', '미확인'), 'menu_name': p['menu_name']})
    with_photo = {r['menu_id']: r['object_path'] for r in photo_rows}
    for r in menu_rows:
        r['image_ref'] = with_photo.get(r['id']) if r['kind'] == 'NEW' else ex_menus[r['id']]['image_ref']
    missing_photo = [{'source_menu_id': r['source_menu_id'], 'name': r['name']} for r in menu_rows if r['image_ref'] is None]

    # ---- 내부 출처 기록 (권리·사용 허락 '미확인')
    ref = f'https://api.coupangeats.com/endpoint/store.get_store_with_menu?storeId={source_store_id}'
    ref_note = '참조 URL은 수집 패키지의 source_endpoint(store.get_store_with_menu)와 source_store_id로 구성한 값이며 정확한 요청 주소는 미확인'
    records = []
    for r in menu_rows:
        status = f'원본 판매 상태: {r["source_sale_status"]}(수집 시점 {report["collected_date"]})'
        if r['source_sale_status'] == 'SOLD_OUT_TODAY' and not r['is_sold_out']:
            status += ' — 수집 당시 오늘 품절이었으나 개발 카탈로그에서는 서정의 앱 표시 결정(2026-11-19)으로 판매 가능으로 표시함(현재 지점에서 판매 가능하다고 확인된 사실이 아님)'
        if r['kind'] == 'LINK':
            note = f'가격 갱신(쿠팡이츠 홍제점 배달앱 가격 {r["base_price"]:,}원, 기존 {r["old_price"]:,}원). {status}. {ref_note}'
        else:
            note = f'새 메뉴. {status}. {ref_note}'
        records.append({'url': ref, 'collected_for': 'MENU_PRICE', 'subject_label': r['name'], 'note': note})
        if r['description'] and (r['kind'] == 'NEW' or r['fills_description']):
            records.append({'url': ref, 'collected_for': 'MENU_DESCRIPTION', 'subject_label': r['name'], 'note': '쿠팡이츠 앱 설명 원문, 권리 미확인'})
    for r in photo_rows:
        records.append({'url': r['source_url'], 'collected_for': 'IMAGE_PAGE', 'subject_label': r['menu_name'], 'note': f'사진 원본 URL, 권리 상태 {r["rights_status"]}'})
    for g in sorted({(o['source_menu_id']) for o in option_rows if o['allow_quantity']}):
        os_ = [o for o in option_rows if o['source_menu_id'] == g and o['allow_quantity']]
        records.append({'url': ref, 'collected_for': 'OTHER', 'subject_label': f'{by_id[g]["name"]} 옵션 수량 조절 {len(os_)}개',
                        'note': f'원본 quantityChangeable=true 선택지 {len(os_)}개. 원본 maxQuantity={sorted({o["source_max_quantity"] for o in os_})}는 보존하고 앱 허용 상한은 {sorted({o["max_quantity"] for o in os_}, key=str)}(서정 확정 값). 원본 값의 의미는 미확인'})
    xs = [o for o in option_rows if o['is_exclusive']]
    if xs:
        records.append({'url': ref, 'collected_for': 'OTHER', 'subject_label': f'단독 옵션 {len(xs)}개(선택안함)',
                        'note': '원본: 선택안함에도 수량 변경 플래그(1~8)가 있고 다른 선택지와의 관계는 자료에 없다. SaveEats 적용: 수량 조절 없이 1개, 같은 그룹의 다른 옵션과 함께 고를 수 없는 단독 옵션(is_exclusive). '
                                '이 규칙은 서정의 SaveEats 제품 결정(2026-11-19)이며 쿠팡이츠에서 실제 동작을 확인한 사실이 아니다'})
    tg = [g for g in group_rows if g['max_total_quantity'] is not None]
    if tg:
        records.append({'url': ref, 'collected_for': 'OTHER', 'subject_label': f'옵션 그룹 수량 합계 제한 {len(tg)}개',
                        'note': f'원본 값: 그룹 maxSelect={sorted({g["source_max_select"] for g in tg})}, 옵션 maxQuantity={sorted({o["source_max_quantity"] for o in option_rows if o["group_id"] in {g["id"] for g in tg}})}. '
                                f'SaveEats 적용값: 그룹 종류 수 상한(max_select) 그대로 + 수량 합계 상한(max_total_quantity)={sorted({g["max_total_quantity"] for g in tg})}. '
                                '합계 제한은 서정의 SaveEats 제품 결정(2026-11-19)이며 쿠팡이츠에서 실제 동작을 확인한 사실이 아니다'})
    records.append({'url': ref, 'collected_for': 'OTHER', 'subject_label': '메뉴 그룹 7개와 순서',
                    'note': '수집한 가게 메뉴 그룹명·소속·순서를 그대로 연결. 개인화 그룹 제외. ' + ref_note})
    for g in virt_del_groups + virt_keep_groups:
        mname = ex_menus[g['menu_id']]['name']
        records.append({'url': ref, 'collected_for': 'OTHER', 'subject_label': f'{mname} / {g["name"]} (기존 가상 옵션 그룹)',
                        'note': ('주문 스냅샷이 가리켜 비활성으로 보존(의존성 점검에서 문제가 있어 삭제 보류)' if g['id'] in keep_groups else
                                 ('주문 스냅샷이 원본 ID로 가리키던 가상 옵션 그룹을 삭제(스냅샷 행은 보존, 원본 ID 대응은 백업의 snapshot_source_id_map.json, 서정 승인)'
                                  if g['id'] in referenced_groups else '실제 옵션으로 교체하며 삭제(참조 없음 확인, 삭제 행은 백업)'))})
    for rm in removals:
        records.append({'url': ref, 'collected_for': 'OTHER', 'subject_label': f'{rm["existing_name"]} (기존 가상 메뉴)',
                        'note': rm['reason'] + (' → 주문·리뷰가 가리켜 삭제하지 않고 숨김(비활성)으로 보존' if rm['action'] == 'DEACTIVATE' else ' → 참조 없음 확인 후 삭제(행은 백업)')})

    return {
        'store': {'id': STORE_ID, 'name': STORE_NAME, 'source_store_id': source_store_id},
        'menus': menu_rows, 'groups': group_rows, 'options': option_rows, 'photos': photo_rows, 'records': records,
        'menu_groups': mgroups, 'menu_group_items': mitems,
        'links': [{'existing_menu_id': l['existing_menu_id'], 'existing_name': l['existing_name'], 'source_menu_id': sid, 'source_name': l['source_name'],
                   'basis': l['basis'], 'evidence': l['evidence']} for sid, l in links.items()],
        'removals': removals, 'virt_del_groups': virt_del_groups, 'virt_del_options': virt_del_options,
        'virt_keep_groups': virt_keep_groups, 'virt_keep_options': virt_keep_options, 'delete_referenced': bool(delete_referenced),
        'snapshot_referenced_groups': snapshot_referenced_groups, 'snapshot_referenced_options': snapshot_referenced_options,
        'kept_photos': kept, 'missing_photo_menus': missing_photo,
        'sold_out_mode': sold_out_mode, 'option_max_quantity': option_max_quantity, 'undecided': undecided,
        'sold_out_today': [r['name'] for r in menu_rows if r['source_sale_status'] == 'SOLD_OUT_TODAY'],
        'issues': issues, 'notes': notes,
    }


def id_map(plan):
    return {'namespace': str(G.NAMESPACE), 'batch': BATCH, 'source_system': SOURCE_SYSTEM,
            'store': {str(plan['store']['source_store_id']): plan['store']['id']},
            'menus': {str(m['source_menu_id']): m['id'] for m in plan['menus']},
            'groups': {g['group_key']: g['id'] for g in plan['groups']},
            'options': {f'{o["group_key"]}:{o["source_option_id"]}': o['id'] for o in plan['options']},
            'menu_groups': {str(g['source_group_id']): g['id'] for g in plan['menu_groups']},
            'note': '원본 숫자 ID는 SaveEats UUID가 아니다. LINK 메뉴는 기존 UUID를 유지한다.'}


# ---------------------------------------------------------------- 보고서
def render_report(plan, state):
    L = []
    w = L.append
    menus, links = plan['menus'], plan['links']
    new = [m for m in menus if m['kind'] == 'NEW']
    w('# 백소정 적용 점검 보고서 (읽기 전용)')
    w('')
    w(f'- 대상 가게: {STORE_NAME} `{STORE_ID}` (기존 가게 확장, 새 가게 없음)')
    w(f'- 상태 출처: {state.get("source")}')
    w(f'- 수집 가게: 백소정 광화문점 (source_store_id={plan["store"]["source_store_id"]})')
    w('')
    w('## 변환 검사')
    w('- 오류: ' + ('없음' if not plan['issues'] else ''))
    for i in plan['issues']:
        w(f'  - {i}')
    for n in plan['notes']:
        w(f'- 참고: {n}')
    w('')
    w('## 개수')
    w(f'- 수집 메뉴 {len(menus)}개 = 기존 UUID 유지 갱신 {len(links)}개 + 새로 추가 {len(new)}개')
    w(f'- 적용 후 활성 메뉴 {sum(1 for m in menus if m["is_active"])}개 (기존 가상 메뉴: 삭제 {sum(1 for r in plan["removals"] if r["action"] == "DELETE")}개, 숨김 보존 {sum(1 for r in plan["removals"] if r["action"] == "DEACTIVATE")}개)')
    w(f'- 옵션 그룹 {len(plan["groups"])}개(필수 {sum(1 for g in plan["groups"] if g["min_select"] >= 1)}), 옵션 {len(plan["options"])}개, 수량 조절 옵션 {sum(1 for o in plan["options"] if o["allow_quantity"])}개')
    w(f'- 메뉴 그룹 {len(plan["menu_groups"])}개, 소속 {len(plan["menu_group_items"])}개 (메뉴 본체 복제 없음)')
    w(f'- 사진: 새로 올림 {len(plan["photos"])}장, 기존 유지 {len(plan["kept_photos"])}장, 미확보 {len(plan["missing_photo_menus"])}개')
    w('')
    w('## 대응표 (기존 메뉴 → 수집 메뉴)')
    w('| 기존 메뉴 | UUID | 수집 메뉴 | 근거 |')
    w('|---|---|---|---|')
    for l in links:
        w(f'| {l["existing_name"]} | `{l["existing_menu_id"]}` | {l["source_name"]} ({l["source_menu_id"]}) | {l["basis"]}: {l["evidence"]} |')
    w('')
    w('## 수집 목록에 없는 기존 메뉴')
    if not plan['removals']:
        w('- 없음(이미 정리됨)')
    for r in plan['removals']:
        if r['action'] == 'DELETE':
            w(f'- {r["existing_name"]} `{r["existing_menu_id"]}`: {r["reason"]} → **삭제 예정**(참조 없음, 적용 직전에 모든 FK 참조를 다시 확인하고 있으면 멈춘다)')
        else:
            w(f'- {r["existing_name"]} `{r["existing_menu_id"]}`: {r["reason"]} → **삭제 불가, 숨김(비활성) 보존** (참조: {r["refs"]})')
    w('')
    w('## 가격 변화 (연결 메뉴)')
    for m in menus:
        if m['kind'] == 'LINK':
            w(f'- {m["name"]}: {m["old_price"]:,}원 → {m["base_price"]:,}원' + (' (설명 채움)' if m['fills_description'] else '') + (f' (표시 이름 "{m["old_name"]}" → "{m["name"]}")' if m['name'] != m['old_name'] else ''))
    w('')
    w('## 기존 가상 옵션·그룹')
    w(f'- 삭제 예정: 그룹 {len(plan["virt_del_groups"])}개, 옵션 {len(plan["virt_del_options"])}개 (삭제할 행 전체를 백업에 저장)')
    w(f'- 이 중 주문 스냅샷이 원본 ID로 가리키는 것: 그룹 {len(plan["snapshot_referenced_groups"])}개, 옵션 {len(plan["snapshot_referenced_options"])}개 (의존성 점검 통과 시에만 삭제, 스냅샷 행은 보존, 원본 ID 대응은 백업에 기록)')
    w(f'- 삭제 보류(비활성 보존): 그룹 {len(plan["virt_keep_groups"])}개, 옵션 {len(plan["virt_keep_options"])}개')
    w('- 의존성 점검: ' + ('통과(FK·함수·뷰·트리거 예상과 같음)' if not plan.get('preflight_problems') else '문제 있음 → ' + '; '.join(plan['preflight_problems'])))
    for g in plan['virt_keep_groups']:
        mname = next((m['name'] for m in state['menus'] if m['id'] == g['menu_id']), '?')
        w(f'  - {mname} / {g["name"]}')
    w('')
    w('## 메뉴 그룹과 순서')
    gname = {g['id']: g['name'] for g in plan['menu_groups']}
    by_menu = {m['id']: m for m in menus}
    w('| # | 앱 표시명 | 원본 이름 | 메뉴 수 | 오늘 품절(수집 당시) | 사진 없음 | 첫 메뉴 → 마지막 메뉴 |')
    w('|---|---|---|---|---|---|---|')
    for g in plan['menu_groups']:
        its = sorted((i for i in plan['menu_group_items'] if i['group_id'] == g['id']), key=lambda i: i['sort_order'])
        rows = [by_menu[i['menu_id']] for i in its]
        sold = sum(1 for r in rows if r['source_sale_status'] == 'SOLD_OUT_TODAY')
        nop = sum(1 for r in rows if r['image_ref'] is None)
        w(f'| {g["sort_order"] + 1} | {g["name"]} | {g["source_name"]} | {len(its)} | {sold} | {nop} | {its[0]["name"]} → {its[-1]["name"]} |')
    w('')
    w('## 옵션 구조 (메뉴마다 별도 그룹·선택지 행으로 만든다)')
    gs = {}
    for g in plan['groups']:
        gs.setdefault((g['name'], g['min_select'], g['max_select'], g['source_type']), []).append(g)
    oq = {}
    for o in plan['options']:
        oq.setdefault(o['group_id'], []).append(o)
    for k, lst in sorted(gs.items()):
        opts = [o for g in lst for o in oq.get(g['id'], [])]
        w(f'- `{k[0].strip()}` 최소 {k[1]}·최대 {k[2]}({k[3]})' + (f'·수량 합계 최대 {lst[0]["max_total_quantity"]}(SaveEats 제품 결정)' if lst[0]['max_total_quantity'] is not None else '') + f': 그룹 {len(lst)}개, 선택지 {len(opts)}개, 수량 허용 {sum(1 for o in opts if o["allow_quantity"])}개, 원본 수량 범위 ' + ', '.join(f'1~{x}({sum(1 for o in opts if o["source_max_quantity"] == x)}개)' for x in sorted({o["source_max_quantity"] for o in opts})) + ', 앱 상한 ' + ', '.join(str(x) for x in sorted({o["max_quantity"] for o in opts if o["allow_quantity"]}, key=str)))
    w('')
    w('## 사진')
    for k in plan['kept_photos']:
        w(f'- 유지(같은 상품을 눈으로 대조, 기존이 더 고해상도): {k["menu"]} `{k["existing_image_ref"]}` (수집 {k["collected_bytes"]:,}B)')
    for m in plan['missing_photo_menus']:
        w(f'- 미확보(대체 사진 없음): {m["name"]}')
    w('')
    w('## 미결정·확인 필요')
    for u in plan['undecided']:
        w(f'- {u}')
    w(f'- 수집일 "오늘 품절" 메뉴 {len(plan["sold_out_today"])}개 → 현재 모드 `{plan["sold_out_mode"]}`')
    if not plan['undecided']:
        w('- 수량 상한: ' + str(plan['option_max_quantity']))
    os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
    text = '\n'.join(L) + '\n'
    with open(os.path.join(HERE, 'out', 'check_report.md'), 'w', encoding='utf-8') as f:
        f.write(text)
    return text


# ---------------------------------------------------------------- 백업
def backup(plan, cur, backup_dir, skip_photos=False):
    os.makedirs(backup_dir, exist_ok=False)
    state = load_existing(cur)
    new_ids = {m['id'] for m in plan['menus'] if m['kind'] == 'NEW'}
    applied_before = [m['name'] for m in state['menus'] if m['id'] in new_ids]
    rm_ids = [r['existing_menu_id'] for r in plan['removals'] if r['action'] == 'DELETE']
    cur.execute('select to_jsonb(m) from public.menus m where m.id = any(%s::uuid[])', (rm_ids,))
    removed_menus = [r[0] for r in cur.fetchall()]
    delete_g = [g['id'] for g in plan['virt_del_groups']]
    delete_o = [o['id'] for o in plan['virt_del_options']]
    cur.execute('select to_jsonb(g) from public.menu_option_groups g where g.id = any(%s::uuid[])', (delete_g,))
    deleted_groups = [r[0] for r in cur.fetchall()]
    cur.execute('select to_jsonb(o) from public.menu_options o where o.id = any(%s::uuid[])', (delete_o,))
    deleted_options = [r[0] for r in cur.fetchall()]
    d_all_o = [o['id'] for o in plan['virt_del_options']]
    d_all_g = [g['id'] for g in plan['virt_del_groups']]
    cur.execute("""select jsonb_build_object('order_id', oi.order_id, 'order_item_id', oio.order_item_id, 'snapshot_row_id', oio.id,
                          'source_group_id', oio.source_group_id, 'source_option_id', oio.source_option_id,
                          'snapshot_group_name', oio.group_name_snapshot, 'snapshot_option_name', oio.option_name_snapshot,
                          'snapshot_additional_price', oio.additional_price_snapshot, 'snapshot_quantity', oio.quantity_snapshot)
                   from public.order_item_options oio join public.order_items oi on oi.id = oio.order_item_id
                   where oio.source_option_id = any(%s::uuid[]) or oio.source_group_id = any(%s::uuid[]) order by oi.order_id, oio.id""", (d_all_o, d_all_g))
    snap_rows = [r[0] for r in cur.fetchall()]
    write_json(os.path.join(backup_dir, 'snapshot_source_id_map.json'),
               {'note': '삭제한 가상 옵션·그룹의 원본 ID와 과거 주문 스냅샷의 원본 ID 대응. 비공개(인증정보 없음). 스냅샷의 이름·가격은 주문 행에 그대로 있다.',
                'deleted_options': {o['id']: {'group': o['group_id'], 'name': o['name']} for o in plan['virt_del_options']},
                'deleted_groups': {g['id']: {'menu': g['menu_id'], 'name': g['name']} for g in plan['virt_del_groups']},
                'snapshot_rows_referencing_deleted': snap_rows})
    files = []
    if not skip_photos:
        refs = sorted({m['image_ref'] for m in state['menus'] if m['image_ref']})
        fdir = os.path.join(backup_dir, 'photo_files')
        os.makedirs(fdir)
        for ref in refs:
            with urllib.request.urlopen(G.public_url(ref), timeout=60) as r:
                data = r.read()
            name = ref.replace('/', '__')
            with open(os.path.join(fdir, name), 'wb') as f:
                f.write(data)
            files.append({'object_path': ref, 'saved_as': 'photo_files/' + name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    data = {'batch': BATCH, 'created_at': datetime.datetime.now().isoformat(timespec='seconds'), 'store_id': STORE_ID,
            'applied_before_backup': applied_before, 'existing': state, 'order_fingerprint': order_fingerprint(cur),
            'other_store_fingerprints': other_store_fingerprints(cur), 'removed_menus': removed_menus,
            'deleted_groups': deleted_groups, 'deleted_options': deleted_options, 'photo_files': files, 'snapshot_rows_referencing_deleted': len(snap_rows),
            'note': '이 백업에는 접속 정보가 없다. 적용 전 상태 기준 복구에만 쓴다'}
    write_json(os.path.join(backup_dir, 'backup.json'), data)
    return data


# ---------------------------------------------------------------- 반영 (한 트랜잭션)
def apply_db(cur, plan, uploaded):
    from psycopg2.extras import execute_values
    cur.execute('select 1 from public.stores where id = %s', (STORE_ID,))
    if not cur.fetchone():
        raise RuntimeError('기존 백소정 가게가 없다')
    # 1) 삭제 대상 메뉴: 참조 재확인 → 옵션·그룹·메뉴 삭제 (참조가 하나라도 있으면 예외로 전체 되돌림). 참조가 있던 메뉴는 숨김으로만 보존
    deact_ids = [r['existing_menu_id'] for r in plan['removals'] if r['action'] == 'DEACTIVATE']
    if deact_ids:
        cur.execute('update public.menus set is_active = false where id = any(%s::uuid[]) and store_id = %s', (deact_ids, STORE_ID))
    rm_ids = [r['existing_menu_id'] for r in plan['removals'] if r['action'] == 'DELETE']
    if rm_ids:
        refs = fk_refs(cur, 'public.menus', rm_ids, ignore=('menu_option_groups', 'store_menu_group_items'))
        if refs:
            raise RuntimeError(f'삭제 대상 메뉴를 가리키는 참조가 있다: {refs}')
        cur.execute('select id::text from public.menu_option_groups where menu_id = any(%s::uuid[])', (rm_ids,))
        gids = [r[0] for r in cur.fetchall()]
        cur.execute('select id::text from public.menu_options where group_id = any(%s::uuid[])', (gids,))
        oids = [r[0] for r in cur.fetchall()]
        for table, ids in (('public.menu_options', oids), ('public.menu_option_groups', gids)):
            r = fk_refs(cur, table, ids, ignore=('menu_options',))
            if r:
                raise RuntimeError(f'삭제 대상 메뉴의 옵션을 가리키는 참조가 있다: {r}')
        cur.execute('select count(*) from public.order_item_options where source_option_id = any(%s::uuid[]) or source_group_id = any(%s::uuid[])', (oids, gids))
        if cur.fetchone()[0]:
            raise RuntimeError('삭제 대상 메뉴의 옵션을 주문 스냅샷이 가리킨다')
        cur.execute('delete from public.menu_options where id = any(%s::uuid[])', (oids,))
        cur.execute('delete from public.menu_option_groups where id = any(%s::uuid[])', (gids,))
        cur.execute('delete from public.menus where id = any(%s::uuid[]) and store_id = %s', (rm_ids, STORE_ID))
        if cur.rowcount != len(rm_ids):
            raise RuntimeError('삭제 대상 메뉴를 모두 지우지 못했다')
    # 2) 메뉴
    new = [m for m in plan['menus'] if m['kind'] == 'NEW']
    linked = [m for m in plan['menus'] if m['kind'] == 'LINK']
    execute_values(cur, """insert into public.menus (id, store_id, name, description, base_price, image_ref, sort_order, is_active, is_sold_out)
        values %s
        on conflict (id) do update set name = excluded.name, description = excluded.description, base_price = excluded.base_price,
          image_ref = coalesce(excluded.image_ref, public.menus.image_ref), sort_order = excluded.sort_order""",
        [(m['id'], STORE_ID, m['name'], m['description'], m['base_price'], m['image_ref'] if m['image_ref'] in uploaded else None,
          m['sort_order'], m['is_active'], m['is_sold_out']) for m in new])
    for m in linked:
        # 표시 이름만 수집본에 맞춘다(rename_to_source). UUID·주문·리뷰·인기 참조는 그대로이고, 과거 주문 스냅샷의 이름(order_items.menu_name_snapshot)은 바꾸지 않는다
        cur.execute("""update public.menus set name = %s, base_price = %s, description = coalesce(description, %s), sort_order = %s
                       where id = %s and store_id = %s""", (m['name'], m['base_price'], m['description'], m['sort_order'], m['id'], STORE_ID))
        if cur.rowcount != 1:
            raise RuntimeError(f'기존 메뉴를 갱신하지 못했다: {m["name"]}')
    # 3) 기존 가상 옵션: 참조 재확인 후 삭제(스냅샷이 가리키는 것은 비활성으로 보존)
    dg = [g['id'] for g in plan['virt_del_groups']]
    do = [o['id'] for o in plan['virt_del_options']]
    if do or dg:
        r = fk_refs(cur, 'public.menu_options', do) or fk_refs(cur, 'public.menu_option_groups', dg, ignore=('menu_options',))
        if r:
            raise RuntimeError(f'삭제 대상 가상 옵션을 가리키는 참조가 있다: {r}')
        cur.execute('select count(*) from public.order_item_options where source_option_id = any(%s::uuid[]) or source_group_id = any(%s::uuid[])', (do, dg))
        n_snap = cur.fetchone()[0]
        allowed = len(plan['snapshot_referenced_options']) + len(plan['snapshot_referenced_groups'])
        if n_snap and not allowed:
            raise RuntimeError('삭제 대상 가상 옵션을 주문 스냅샷이 가리킨다(삭제 보류 상태)')
        if allowed:
            problems = snapshot_preflight(cur)
            if problems:
                raise RuntimeError('스냅샷이 가리키는 가상 옵션 삭제 전 의존성 점검 실패: ' + '; '.join(problems))
        cur.execute('delete from public.menu_options where id = any(%s::uuid[])', (do,))
        cur.execute('delete from public.menu_option_groups where id = any(%s::uuid[])', (dg,))
    if plan['virt_keep_options']:
        cur.execute('update public.menu_options set is_active = false where id = any(%s::uuid[])', ([o['id'] for o in plan['virt_keep_options']],))
    if plan['virt_keep_groups']:
        cur.execute('update public.menu_option_groups set is_active = false where id = any(%s::uuid[])', ([g['id'] for g in plan['virt_keep_groups']],))
    # 4) 실제 옵션 그룹·옵션
    execute_values(cur, """insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order, is_active, max_total_quantity)
        values %s
        on conflict (id) do update set name = excluded.name, min_select = excluded.min_select, max_select = excluded.max_select,
          sort_order = excluded.sort_order, is_active = excluded.is_active, max_total_quantity = excluded.max_total_quantity""",
        [(g['id'], g['menu_id'], g['name'], g['min_select'], g['max_select'], g['sort_order'], g['is_active'], g['max_total_quantity']) for g in plan['groups']], page_size=500)
    execute_values(cur, """insert into public.menu_options (id, group_id, name, additional_price, allow_quantity, max_quantity, sort_order, is_active, is_sold_out, is_exclusive)
        values %s
        on conflict (id) do update set name = excluded.name, additional_price = excluded.additional_price, allow_quantity = excluded.allow_quantity,
          max_quantity = excluded.max_quantity, sort_order = excluded.sort_order, is_active = true, is_exclusive = excluded.is_exclusive""",
        [(o['id'], o['group_id'], o['name'], o['additional_price'], o['allow_quantity'], o['max_quantity'], o['sort_order'], True, False, o['is_exclusive']) for o in plan['options']],
        page_size=500)
    # 5) 가게 안 메뉴 그룹 (이 가게의 이 배치 그룹만 다시 만든다. 메뉴 본체는 건드리지 않는다)
    gids = [g['id'] for g in plan['menu_groups']]
    cur.execute('delete from public.store_menu_group_items where store_id = %s and group_id = any(%s::uuid[])', (STORE_ID, gids))
    execute_values(cur, """insert into public.store_menu_groups (id, store_id, name, source_name, sort_order, is_active) values %s
        on conflict (id) do update set name = excluded.name, source_name = excluded.source_name, sort_order = excluded.sort_order, is_active = true""",
        [(g['id'], STORE_ID, g['name'], g['source_name'], g['sort_order'], True) for g in plan['menu_groups']])
    execute_values(cur, 'insert into public.store_menu_group_items (group_id, store_id, menu_id, sort_order) values %s',
                   [(i['group_id'], STORE_ID, i['menu_id'], i['sort_order']) for i in plan['menu_group_items']])
    # 6) 내부 출처 기록
    # 재실행해도 중복이 없고, 처음 적용 때 남긴 기록(예: 삭제한 가상 옵션)이 사라지지 않게 지우지 않고 같은 키는 갱신한다
    execute_values(cur, """insert into private.store_source_records
          (store_id, url, collected_for, subject_label, host_kind, rights_permission, reuse_permission, evidence, note, checked_on, load_batch) values %s
        on conflict (store_id, url, collected_for, (coalesce(subject_label, ''))) do update set note = excluded.note, evidence = excluded.evidence,
          rights_permission = excluded.rights_permission, reuse_permission = excluded.reuse_permission, load_batch = excluded.load_batch""",
        [(STORE_ID, r['url'], r['collected_for'], r['subject_label'], 'PLATFORM', '미확인', '미확인',
          '쿠팡이츠 앱 수집(백소정 광화문점, source_store_id=%s). 개발 서버 적용이며 외부 공개 승인이 아님' % plan['store']['source_store_id'],
          r['note'], '2026-11-19', BATCH) for r in plan['records']], page_size=500)


def restore_db(cur, plan, bk):
    """이번 적용분만 되돌린다. 새 행 삭제 → 삭제했던 행 복원 → 연결 메뉴의 가격·설명·순서·옵션 활성 상태 복원."""
    from psycopg2.extras import Json
    new_ids = [m['id'] for m in plan['menus'] if m['kind'] == 'NEW']
    cur.execute('select count(*) from public.order_items where menu_id = any(%s::uuid[])', (new_ids,))
    if cur.fetchone()[0]:
        raise RuntimeError('새 메뉴를 가리키는 주문이 있어 지울 수 없다')
    cur.execute('select count(*) from public.order_item_options where source_option_id = any(%s::uuid[])', ([o['id'] for o in plan['options']],))
    if cur.fetchone()[0]:
        raise RuntimeError('새 옵션을 가리키는 주문이 있어 지울 수 없다')
    cur.execute('delete from public.store_menu_group_items where store_id = %s and group_id = any(%s::uuid[])', (STORE_ID, [g['id'] for g in plan['menu_groups']]))
    cur.execute('delete from public.store_menu_groups where store_id = %s and id = any(%s::uuid[])', (STORE_ID, [g['id'] for g in plan['menu_groups']]))
    cur.execute('delete from public.menu_options where id = any(%s::uuid[])', ([o['id'] for o in plan['options']],))
    cur.execute('delete from public.menu_option_groups where id = any(%s::uuid[])', ([g['id'] for g in plan['groups']],))
    cur.execute('delete from public.menus where id = any(%s::uuid[])', (new_ids,))
    cur.execute('delete from private.store_source_records where load_batch = %s and store_id = %s', (BATCH, STORE_ID))
    for table, rows in (('menus', bk['removed_menus']), ('menu_option_groups', bk['deleted_groups']), ('menu_options', bk['deleted_options'])):
        if rows:
            cur.execute(f'insert into public.{table} select * from jsonb_populate_recordset(null::public.{table}, %s::jsonb) on conflict (id) do nothing', (json.dumps(rows),))
    before = bk['existing']
    for m in before['menus']:
        cur.execute('update public.menus set name = %s, base_price = %s, description = %s, sort_order = %s, is_active = %s where id = %s', (m['name'], m['base_price'], m['description'], m['sort_order'], m['is_active'], m['id']))
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
    linked = [m for m in plan['menus'] if m['kind'] == 'LINK']
    check('가게 UUID 유지', now['store'] and now['store']['id'] == STORE_ID)
    check('수집 메뉴 전부 존재(매핑 누락·중복 없음)', len({m['id'] for m in plan['menus']}) == len(plan['menus']) and all(m['id'] in menus_db for m in plan['menus']))
    check('기존 연결 메뉴 UUID 유지', all(m['id'] in menus_db for m in linked))
    check('삭제 대상 기존 메뉴가 없다', all(r['existing_menu_id'] not in menus_db for r in plan['removals'] if r['action'] == 'DELETE'))
    check('참조가 있어 보존한 기존 메뉴는 숨김(비활성)이다', all(r['existing_menu_id'] in menus_db and not menus_db[r['existing_menu_id']]['is_active'] for r in plan['removals'] if r['action'] == 'DEACTIVATE'))
    n_deact = sum(1 for r in plan['removals'] if r['action'] == 'DEACTIVATE')
    check('서버 메뉴 수 = 수집 메뉴 수 + 숨김 보존 메뉴(남는 기존 활성 메뉴 없음)', len(menus_db) == len(plan['menus']) + n_deact and sum(1 for m in menus_db.values() if m['is_active']) == len(plan['menus']), f'{len(menus_db)} / {len(plan["menus"])}+{n_deact}')
    check('메뉴 이름 일치(연결 메뉴는 수집본 표시 이름으로 맞춤, 새 메뉴는 원본 이름 그대로)', all(menus_db[m['id']]['name'] == m['name'] for m in plan['menus'] if m['id'] in menus_db))
    check('메뉴 가격 일치', all(menus_db[m['id']]['base_price'] == m['base_price'] for m in plan['menus'] if m['id'] in menus_db))
    check('메뉴 순서(sort_order) 일치', all(menus_db[m['id']]['sort_order'] == m['sort_order'] for m in plan['menus'] if m['id'] in menus_db))
    if photos_expected:
        check('사진 연결(새 메뉴=새 경로, 기존 메뉴=기존 사진 유지, 사진 없는 메뉴는 NULL)', all(menus_db[m['id']]['image_ref'] == m['image_ref'] for m in plan['menus'] if m['id'] in menus_db))
    miss_ids = {next(x['id'] for x in plan['menus'] if x['source_menu_id'] == m['source_menu_id']) for m in plan['missing_photo_menus']}
    check('사진 없는 메뉴에 사진이 없다', all(menus_db[i]['image_ref'] is None for i in miss_ids if i in menus_db))
    if before is not None:
        check('가게 대표사진 유지', now['store']['image_ref'] == before['existing']['store']['image_ref'])
        check('추천·인기·활성 보존(연결 메뉴)', all(menus_db[i]['is_popular'] == m['is_popular'] and menus_db[i]['popularity_score'] == m['popularity_score']
                                          and menus_db[i]['is_active'] == m['is_active']
                                          for i, m in {m['id']: m for m in before['existing']['menus']}.items() if i in menus_db and i not in {r['existing_menu_id'] for r in plan['removals']}))
        check('주문·리뷰 스냅샷 해시 변경 없음', order_fingerprint(cur) == before['order_fingerprint'])
        check('다른 가게 변경 없음', other_store_fingerprints(cur) == before['other_store_fingerprints'])
        check('공개 출처 목록 변경 없음', now['refs']['store_sources'] == before['existing']['refs']['store_sources'])
        check('주문·리뷰 참조 건수 변경 없음', {k: now['refs'][k] for k in ('orders', 'order_items', 'order_item_options', 'review_menus')}
              == {k: before['existing']['refs'][k] for k in ('orders', 'order_items', 'order_item_options', 'review_menus')})
    check('옵션 그룹 일치(활성)', all(groups_db.get(g['id'], {}).get('max_select') == g['max_select'] and groups_db[g['id']]['min_select'] == g['min_select']
                              and groups_db[g['id']]['is_active'] == g['is_active'] and groups_db[g['id']]['name'] == g['name'] for g in plan['groups'] if g['id'] in groups_db)
          and all(g['id'] in groups_db for g in plan['groups']))
    check('옵션 추가금·수량 설정 일치(활성)', all(o['id'] in options_db and (options_db[o['id']]['additional_price'], options_db[o['id']]['allow_quantity'], options_db[o['id']]['max_quantity'])
                                          == (o['additional_price'], o['allow_quantity'], o['max_quantity']) and options_db[o['id']]['is_active'] for o in plan['options']))
    cur.execute('select g.id::text, g.max_total_quantity from public.menu_option_groups g join public.menus m on m.id = g.menu_id where m.store_id = %s', (STORE_ID,))
    tot_db = {r[0]: r[1] for r in cur.fetchall()}
    cur.execute('select o.id::text, o.is_exclusive from public.menu_options o join public.menu_option_groups g on g.id = o.group_id join public.menus m on m.id = g.menu_id where m.store_id = %s', (STORE_ID,))
    ex_db = {r[0]: r[1] for r in cur.fetchall()}
    check('단독 옵션 표시 일치(선택안함 지정 옵션만 true, 나머지는 false)', all(ex_db.get(o['id']) == o['is_exclusive'] for o in plan['options']))
    check('옵션 그룹 수량 합계 상한 일치(제한 없는 그룹은 null)', all(tot_db.get(g['id']) == g['max_total_quantity'] for g in plan['groups']))
    planned_g = {g['id'] for g in plan['groups']}
    hidden_menus = {r['existing_menu_id'] for r in plan['removals'] if r['action'] == 'DEACTIVATE'}  # 숨김 보존 메뉴의 기존 옵션은 메뉴째 앱에 보이지 않는다
    check('기존 가상 옵션·그룹이 보이는 메뉴에 활성으로 남지 않았다', all((not g['is_active']) for gid, g in groups_db.items() if gid not in planned_g and g['menu_id'] not in hidden_menus)
          and all((not o['is_active']) for oid, o in options_db.items() if o['group_id'] not in planned_g and groups_db[o['group_id']]['menu_id'] not in hidden_menus))
    check('삭제 예정 가상 옵션이 실제로 지워졌다', all(g['id'] not in groups_db for g in plan['virt_del_groups']) and all(o['id'] not in options_db for o in plan['virt_del_options']))
    check('삭제 보류한(스냅샷이 가리키고 점검 문제가 있는) 가상 옵션은 비활성으로 남았다', all(g['id'] in groups_db and not groups_db[g['id']]['is_active'] for g in plan['virt_keep_groups']))
    check('스냅샷이 원본 ID로 가리키던 가상 옵션·그룹도 삭제됐다(스냅샷 행은 보존)', all(g['id'] not in groups_db for g in plan['snapshot_referenced_groups'])
          and all(o['id'] not in options_db for o in plan['snapshot_referenced_options']))
    # 메뉴 그룹
    mg = {g['id']: g for g in now['menu_groups']}
    items = {}
    for i in now['menu_group_items']:
        items.setdefault(i['group_id'], []).append(i)
    check('메뉴 그룹 7개와 순서·이름', [g['name'] for g in sorted(mg.values(), key=lambda g: g['sort_order'])] == [g['name'] for g in plan['menu_groups']], [g['name'] for g in mg.values()])
    check('그룹 안 메뉴 순서 일치', all([i['menu_id'] for i in sorted(items.get(g['id'], []), key=lambda i: i['sort_order'])] == [i['menu_id'] for i in sorted(
        (x for x in plan['menu_group_items'] if x['group_id'] == g['id']), key=lambda x: x['sort_order'])] for g in plan['menu_groups']))
    check('그룹 소속 연결이 계획과 같다(고유 메뉴 수와 소속 수를 따로 센다, 모든 메뉴가 하나 이상의 그룹에 있다)', sorted((i['group_id'], i['menu_id']) for lst in items.values() for i in lst) == sorted((x['group_id'], x['menu_id']) for x in plan['menu_group_items'])
          and {i['menu_id'] for lst in items.values() for i in lst} == {m['id'] for m in plan['menus']})
    check('수집 순서대로 menus 정렬(기존/신규 구분 없음)', [m['id'] for m in sorted((m for m in now['menus'] if m['id'] in {x['id'] for x in plan['menus']}), key=lambda m: m['sort_order'])] == [i for i in dict.fromkeys(i['menu_id'] for g in plan['menu_groups'] for i in sorted(
        (x for x in plan['menu_group_items'] if x['group_id'] == g['id']), key=lambda x: x['sort_order']))])
    # 금액 계산: 수량 옵션 2개 × 개당 추가금 × 메뉴 2개 (읽기 전용 서버 함수로 확인)
    sauce = [o for o in plan['options'] if o['allow_quantity']]
    seen_menus = set()
    for o in sauce:
        group = next(g for g in plan['groups'] if g['id'] == o['group_id'])
        menu = next(m for m in plan['menus'] if m['id'] == group['menu_id'])
        if menu['id'] in seen_menus or len(seen_menus) >= 3 or not menu['is_active']:
            continue
        seen_menus.add(menu['id'])
        picked = [(o['id'], 2, o['additional_price'])]
        for g in plan['groups']:
            if g['menu_id'] == menu['id'] and g['min_select'] >= 1 and g['id'] != o['group_id'] and g['is_active']:
                opts = sorted((x for x in plan['options'] if x['group_id'] == g['id']), key=lambda x: (x['sort_order'], x['id']))[:g['min_select']]
                picked += [(x['id'], 1, x['additional_price']) for x in opts]
        picked.sort(key=lambda t: t[0])
        unit = menu['base_price'] + sum(price * qty for _, qty, price in picked)
        lines = [{'menuId': menu['id'], 'optionIds': [t[0] for t in picked], 'optionQuantities': [t[1] for t in picked], 'quantity': 2, 'approvedUnitPrice': unit}]
        cur.execute('select private.validate_order_catalog(%s::uuid, %s::jsonb, %s::bigint, false)', (STORE_ID, json.dumps(lines), unit * 2))
        snap = cur.fetchone()[0]
        sl = next(x for x in snap['lines'][0]['options'] if x['optionId'] == o['id'])
        check(f'{menu["name"]}: {o["name"]} 2개 = {o["additional_price"] * 2:,}원', sl['quantity'] == 2 and sl['additionalPrice'] * sl['quantity'] == o['additional_price'] * 2, sl)
        check(f'{menu["name"]}: (기본가+옵션 합) {unit:,}원 × 메뉴 2개', snap['total'] == unit * 2, snap['total'])
    # 음료 합계 규칙(서버 주문 검증, 읽기 전용 함수): 같은 음료 2개·서로 다른 음료 1개씩은 통과, 합계 3개는 거절
    dg = next((g for g in plan['groups'] if g['max_total_quantity'] is not None and g['menu_id'] in {m['id'] for m in plan['menus'] if m['is_active']}), None)
    if dg is not None:
        dopts = sorted((o for o in plan['options'] if o['group_id'] == dg['id'] and o['allow_quantity']), key=lambda x: (x['sort_order'], x['id']))
        dmenu = next(m for m in plan['menus'] if m['id'] == dg['menu_id'])

        def try_lines(picked):
            picked = sorted(picked, key=lambda t: t[0]['id'])
            unit = dmenu['base_price'] + sum(o['additional_price'] * q for o, q in picked)
            line = [{'menuId': dmenu['id'], 'optionIds': [o['id'] for o, _ in picked], 'optionQuantities': [q for _, q in picked], 'quantity': 1, 'approvedUnitPrice': unit}]
            cur.execute('savepoint tq')
            try:
                cur.execute('select private.validate_order_catalog(%s::uuid, %s::jsonb, %s::bigint, false)', (STORE_ID, json.dumps(line), unit))
                cur.fetchone()
                cur.execute('release savepoint tq')
                return 'OK'
            except Exception as e:
                cur.execute('rollback to savepoint tq')
                return getattr(e, 'pgerror', str(e)).splitlines()[0]
        lim = dg['max_total_quantity']
        check(f'음료 {dopts[0]["name"]} {lim}개(같은 음료 합계 {lim}): 서버 통과', try_lines([(dopts[0], lim)]) == 'OK')
        check('서로 다른 음료 1개씩: 서버 통과', try_lines([(dopts[0], 1), (dopts[1], 1)]) == 'OK')
        check(f'음료 합계 {lim + 1}개(같은 음료 {lim} + 다른 음료 1): 서버 INVALID_OPTIONS', 'INVALID_OPTIONS' in try_lines([(dopts[0], lim), (dopts[1], 1)]))
    # 단독 옵션 규칙(서버 주문 검증, 읽기 전용 함수): 단독 옵션만 선택은 통과, 같은 그룹의 다른 옵션과 함께는 INVALID_OPTIONS
    xo = next((o for o in plan['options'] if o['is_exclusive']), None)
    if xo is not None:
        xg = next(g for g in plan['groups'] if g['id'] == xo['group_id'])
        xmenu = next(m for m in plan['menus'] if m['id'] == xg['menu_id'])
        others = sorted((o for o in plan['options'] if o['group_id'] == xg['id'] and not o['is_exclusive']), key=lambda x: (x['sort_order'], x['id']))

        def try_x(picked):
            picked = sorted(picked, key=lambda t: t[0]['id'])
            unit = xmenu['base_price'] + sum(o['additional_price'] * q for o, q in picked)
            line = [{'menuId': xmenu['id'], 'optionIds': [o['id'] for o, _ in picked], 'optionQuantities': [q for _, q in picked], 'quantity': 1, 'approvedUnitPrice': unit}]
            cur.execute('savepoint xq')
            try:
                cur.execute('select private.validate_order_catalog(%s::uuid, %s::jsonb, %s::bigint, false)', (STORE_ID, json.dumps(line), unit))
                cur.fetchone()
                cur.execute('release savepoint xq')
                return 'OK'
            except Exception as e:
                cur.execute('rollback to savepoint xq')
                return getattr(e, 'pgerror', str(e)).splitlines()[0]
        check(f'{xo["name"]}만 선택: 서버 통과(필수 충족)', try_x([(xo, 1)]) == 'OK')
        check(f'{xo["name"]} + {others[0]["name"]}: 서버 INVALID_OPTIONS', 'INVALID_OPTIONS' in try_x([(xo, 1), (others[0], 1)]))
        check(f'{others[0]["name"]} + {others[1]["name"]}(일반 토핑 여러 종류): 서버 통과', try_x([(others[0], 1), (others[1], 2)]) == 'OK')
    fails = [r for r in results if not r[1]]
    print(f'{len(results) - len(fails)} / {len(results)} 통과')
    return not fails


def anon_verify(plan):
    """Guest(anon): get_menu·get_store 응답이 계획과 같고(가상 옵션이 안 보임) 사진이 실제로 받아지는지 본다. 공개 키만 쓴다."""
    base = os.environ.get('SUPABASE_URL') or os.environ.get('EXPO_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    if not base or not key:
        sys.exit('anon 검증에는 SUPABASE_URL과 SUPABASE_PUBLISHABLE_KEY(공개 키)가 필요합니다.')

    def rpc(name, body):
        req = urllib.request.Request(base.rstrip('/') + f'/rest/v1/rpc/{name}', data=json.dumps(body).encode(), method='POST')
        req.add_header('apikey', key)
        req.add_header('Content-Type', 'application/json')
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())

    bad = []
    try:
        store = rpc('get_store', {'p_store_id': STORE_ID})
    except Exception as e:
        print('FAIL get_store 조회 실패 ' + safe_error(e))
        return False
    want_groups = [(g['name'], [i['menu_id'] for i in sorted((x for x in plan['menu_group_items'] if x['group_id'] == g['id']), key=lambda x: x['sort_order'])]) for g in plan['menu_groups']]
    got_groups = [(g['name'], g['menuIds']) for g in store.get('menuGroups', [])]
    if got_groups != want_groups:
        bad.append(('get_store', '메뉴 그룹 이름·순서·소속이 계획과 다르다'))
    if [m['id'] for m in store['menus']] != [i for _, ids in want_groups for i in ids]:
        bad.append(('get_store', 'menus 순서가 수집 순서와 다르다'))
    gm, og = {}, {}
    for g in plan['groups']:
        if g['is_active']:   # 숨긴 그룹(리뷰이벤트)은 앱 응답에 없어야 한다
            gm.setdefault(g['menu_id'], []).append(g)
    for o in plan['options']:
        og.setdefault(o['group_id'], []).append(o)
    for m in plan['menus']:
        if not m['is_active']:
            continue
        try:
            dto = rpc('get_menu', {'p_menu_id': m['id']})
        except Exception as e:
            bad.append((m['name'], '조회 실패 ' + safe_error(e)))
            continue
        if dto['price'] != m['base_price']:
            bad.append((m['name'], f'가격 {dto["price"]} != {m["base_price"]}'))
        want = {g['id']: sorted((o['id'], o['additional_price'], o['allow_quantity'], o['max_quantity'], o['is_exclusive']) for o in og.get(g['id'], [])) for g in gm.get(m['id'], [])}
        got = {g['id']: sorted((o['id'], o['additionalPrice'], o.get('maxQuantity') is not None, o.get('maxQuantity'), o.get('isExclusive') is True) for o in g['options']) for g in dto['optionGroups']}
        if want != got:
            bad.append((m['name'], '옵션 그룹·선택지·추가금·수량 상한이 다름(가상 옵션이 함께 보이는 경우 포함)'))
        if {g['id']: (g['minSelect'], g['maxSelect'], g.get('maxTotalQuantity')) for g in dto['optionGroups']} != {g['id']: (g['min_select'], g['max_select'], g['max_total_quantity']) for g in gm.get(m['id'], [])}:
            bad.append((m['name'], '필수·최대 선택(종류 수)·수량 합계 제한이 다름'))
    n_active = sum(1 for m in plan['menus'] if m['is_active'])
    print(f'anon get_store 그룹·순서 {"일치" if not [b for b in bad if b[0] == "get_store"] else "불일치"} / get_menu {n_active - len([b for b in bad if b[0] != "get_store"])} / {n_active} 일치')
    for b in bad[:10]:
        print('FAIL', b)
    photo_bad = []
    for p in plan['photos']:
        try:
            with urllib.request.urlopen(G.public_url(p['object_path']), timeout=30) as r:
                if hashlib.sha256(r.read()).hexdigest() != p['sha256']:
                    photo_bad.append(p['object_path'])
        except Exception:
            photo_bad.append(p['object_path'])
    print(f'anon 사진 조회: {len(plan["photos"]) - len(photo_bad)} / {len(plan["photos"])} 일치')
    return not bad and not photo_bad


# ---------------------------------------------------------------- 실행
def new_backup_dir(suffix=''):
    """같은 이름의 백업은 덮어쓰지 않는다(같은 초에 두 번 만들면 번호를 붙인다)."""
    base = os.path.join(BACKUP_ROOT, datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + suffix)
    d, n = base, 1
    while os.path.exists(d):
        n += 1
        d = f'{base}-{n}'
    return d


def newest_backup():
    if not os.path.isdir(BACKUP_ROOT):
        return None
    dirs = sorted(d for d in os.listdir(BACKUP_ROOT) if os.path.exists(os.path.join(BACKUP_ROOT, d, 'backup.json')))
    return os.path.join(BACKUP_ROOT, dirs[-1]) if dirs else None


def main():
    G.install_safe_excepthook()
    load_env_file()
    ap = argparse.ArgumentParser(description='백소정 기존 가게 확장 적용(개발 서버 전용)')
    ap.add_argument('--package', required=True, help='수집 자료 폴더(읽기 전용)')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--backup', action='store_true')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--restore', action='store_true')
    ap.add_argument('--backup-dir')
    ap.add_argument('--yes-dev-project', action='store_true', help=f'개발 프로젝트({DEV_REF})임을 확인했다')
    ap.add_argument('--option-max-quantity', type=int, help='서정이 정한 옵션 수량 앱 허용 상한(적용에 필수)')
    ap.add_argument('--sold-out-mode', choices=['ignore', 'source'], help='수집 당시 "오늘 품절"을 반영할지(ignore=판매 가능으로 표시, source=품절로 표시). 적용에 필수')
    ap.add_argument('--none-option-mode', choices=['source', 'no-quantity', 'exclusive'], help='"선택안함" 옵션: source=원본 수량 변경 플래그 그대로, no-quantity=수량 조절 없이 1개, exclusive=수량 조절 없이 1개 + 같은 그룹의 다른 옵션과 함께 고를 수 없는 단독 옵션(is_exclusive). option_policy.json의 원본 ID만. 적용에 필수')
    ap.add_argument('--review-event-groups', choices=['import', 'hidden'], help='쿠팡이츠 "리뷰이벤트" 옵션 그룹: import=앱에 노출, hidden=행은 보존하고 앱에는 숨김. 적용에 필수')
    ap.add_argument('--group-total-mode', choices=['none', 'source-max'], help='원본 그룹 최대가 1000 미만인 수량형 그룹: none=수량 합계 제한 없음, source-max=그룹 최대를 수량 합계 상한으로. 적용에 필수')
    ap.add_argument('--group-names', choices=['source', 'proposed'], help='메뉴 그룹 표시명: source=원본 그대로, proposed=menu_group_display.json 제안. 적용에 필수')
    ap.add_argument('--no-option-quantity', action='store_true')
    ap.add_argument('--skip-photos', action='store_true', help='시험 전용: 사진 업로드·조회를 건너뜀')
    ap.add_argument('--snapshot', help='읽기 전용 점검용: DB 대신 상태 JSON 파일')
    a = ap.parse_args()

    if a.snapshot:
        state = read_json(a.snapshot)
        state['source'] = 'snapshot'
        conn = cur = None
    else:
        conn = G.connect()
        cur = conn.cursor()
        state = load_existing(cur)
    preflight_problems = snapshot_preflight(cur) if cur else ['스냅샷 모드(DB 미연결)']
    menu_refs = {}
    if cur:
        for rm in read_json(os.path.join(HERE, 'menu_mapping.json'))['remove']:
            menu_refs[rm['existing_menu_id']] = fk_refs(cur, 'public.menus', [rm['existing_menu_id']], ignore=('menu_option_groups', 'store_menu_group_items'))
    else:
        menu_refs = {m['id']: m.get('_refs', {}) for m in state.get('menus', [])}
    plan = build_plan(a.package, state, a.option_max_quantity, a.sold_out_mode, not a.no_option_quantity, delete_referenced=not preflight_problems,
                      menu_refs=menu_refs, group_names=a.group_names, none_mode=a.none_option_mode, review_mode=a.review_event_groups, total_mode=a.group_total_mode)
    plan['preflight_problems'] = preflight_problems
    write_json(os.path.join(HERE, 'id_map.json'), id_map(plan))

    if a.check or not (a.backup or a.apply or a.verify or a.restore):
        print(render_report(plan, state))
        print('보고서: out/check_report.md')
        sys.exit(1 if plan['issues'] else 0)

    sup = os.environ.get('SUPABASE_URL') or ''
    if (a.backup or a.apply or a.restore) and not a.yes_dev_project:
        sys.exit(f'개발 프로젝트({DEV_REF})에만 씁니다. 확인했다면 --yes-dev-project 를 붙여 주세요.')
    if sup and DEV_REF not in sup and (a.backup or a.apply or a.restore):
        sys.exit('SUPABASE_URL이 개발 프로젝트가 아닙니다. 중단합니다.')

    if a.verify:
        bk = read_json(os.path.join(a.backup_dir, 'backup.json')) if a.backup_dir else None
        ok = verify(plan, cur, bk, not a.skip_photos)
        if not a.skip_photos:
            ok = anon_verify(plan) and ok
        sys.exit(0 if ok else 1)

    if a.backup:
        d = new_backup_dir()
        data = backup(plan, cur, d, a.skip_photos)
        conn.rollback()
        print('백업 저장:', os.path.relpath(d, HERE), f'(사진 {len(data["photo_files"])}개, 삭제 예정 행: 메뉴 {len(data["removed_menus"])}, 그룹 {len(data["deleted_groups"])}, 옵션 {len(data["deleted_options"])})')
        if data['applied_before_backup']:
            print('경고: 이미 적용된 뒤의 상태라 이 백업은 복구 기준이 아닙니다.')
        return

    if a.restore:
        if not a.backup_dir:
            sys.exit('--restore 에는 --backup-dir 가 필요합니다(적용 전에 만든 백업).')
        bk = read_json(os.path.join(a.backup_dir, 'backup.json'))
        if bk['applied_before_backup']:
            sys.exit('이 백업은 이미 적용된 뒤에 만든 것이라 복구 기준이 아닙니다.')
        try:
            restore_db(cur, plan, bk)
            conn.commit()
        except Exception as e:
            conn.rollback()
            sys.exit('복구 실패(되돌림): ' + safe_error(e))
        removed = 0
        if not a.skip_photos:
            for p in plan['photos']:
                st, _ = G.storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}')
                removed += st in (200, 204, 404)
        print(f'복구 완료(새 사진 {removed}개 삭제). 검증:')
        ok = verify_restored(cur, plan, bk)
        sys.exit(0 if ok else 1)

    # --apply
    if plan['issues']:
        sys.exit('변환 검사 오류가 있어 적용하지 않습니다:\n- ' + '\n- '.join(plan['issues']))
    cur.execute("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'menu_option_groups' and column_name = 'max_total_quantity'")
    if not cur.fetchone():
        sys.exit('서버에 migration 20261119101123_option_group_total_quantity.sql(옵션 그룹 수량 합계 제한)이 아직 없어 적용하지 않습니다. 먼저 이 migration을 적용하세요.')
    cur.execute("select 1 from information_schema.columns where table_schema = 'public' and table_name = 'menu_options' and column_name = 'is_exclusive'")
    if not cur.fetchone():
        sys.exit('서버에 migration option_exclusive(menu_options.is_exclusive)가 아직 없어 적용하지 않습니다. 먼저 이 migration을 적용하세요.')
    if plan['undecided']:
        sys.exit('미결정 항목이 있어 적용하지 않습니다:\n- ' + '\n- '.join(plan['undecided']))
    d = new_backup_dir('-pre-apply')
    bk = backup(plan, cur, d, a.skip_photos)
    conn.rollback()
    if bk['applied_before_backup']:
        print('참고: 이미 적용된 메뉴가 있어 재실행으로 보고 진행합니다(이 백업은 복구 기준이 아닙니다). 최초 적용 전 백업을 보관하세요.')
    print('백업:', os.path.relpath(d, HERE))
    uploaded = []
    if not a.skip_photos:
        done, failed = G.upload_photos(plan)
        uploaded = done
        if failed:
            for p, st, why in failed[:10]:
                print('업로드 실패:', p, st, why)
            print('사진 업로드에 실패해 DB를 반영하지 않고 멈춥니다. 이번에 올린 파일을 정리합니다.')
            for p in plan['photos']:
                if p['object_path'] in done and not any(x['object_path'] == p['object_path'] for x in bk['photo_files']):
                    G.storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}')
            sys.exit(1)
        print(f'사진 업로드 {len(done)}장 완료')
    else:
        uploaded = [p['object_path'] for p in plan['photos']]
    try:
        apply_db(cur, plan, set(uploaded))
        print('DB 반영(트랜잭션 안) 후 검증:')
        if not verify(plan, cur, bk, not a.skip_photos):
            raise RuntimeError('검증 실패')
        conn.commit()
    except Exception as e:
        conn.rollback()
        print('DB 반영 실패(전체 되돌림): ' + safe_error(e))
        if not a.skip_photos:
            for p in plan['photos']:
                G.storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}')
            print('이번에 올린 새 사진도 삭제했습니다.')
        sys.exit(1)
    print('적용 완료.')
    if not a.skip_photos:
        if not anon_verify(plan):
            sys.exit(1)


def verify_restored(cur, plan, bk):
    state = load_existing(cur)
    b = bk['existing']
    ok = True
    menus = {m['id']: m for m in state['menus']}
    for m in b['menus']:
        now = menus.get(m['id'])
        good = now and all(now[k] == m[k] for k in ('name', 'base_price', 'description', 'sort_order', 'image_ref', 'is_active', 'is_sold_out'))
        print(('PASS ' if good else 'FAIL ') + f'복구: {m["name"]}')
        ok = ok and bool(good)
    n_ok = len(state['menus']) == len(b['menus'])
    print(('PASS ' if n_ok else 'FAIL ') + f'복구: 메뉴 수 {len(state["menus"])} / {len(b["menus"])}')
    og = {g['id']: g for g in state['groups']}
    go = all(g['id'] in og and og[g['id']]['is_active'] == g['is_active'] for g in b['groups'])
    print(('PASS ' if go else 'FAIL ') + '복구: 옵션 그룹')
    f1 = order_fingerprint(cur) == bk['order_fingerprint']
    print(('PASS ' if f1 else 'FAIL ') + '복구: 주문·리뷰 스냅샷 해시')
    f2 = other_store_fingerprints(cur) == bk['other_store_fingerprints']
    print(('PASS ' if f2 else 'FAIL ') + '복구: 다른 가게 해시')
    fp = f1 and f2
    return ok and n_ok and go and fp and len(state['menu_groups']) == len(b['menu_groups'])


if __name__ == '__main__':
    main()
