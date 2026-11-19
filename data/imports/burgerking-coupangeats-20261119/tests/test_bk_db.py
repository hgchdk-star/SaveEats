# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해
미결정 거절·적용·Guest 응답·그룹 중복 소속·필수 옵션·재실행·복구·스냅샷 참조 가상 옵션 분기를 시험한다. 실서버에는 연결하지 않는다.
실행: BK_PACKAGE=<수집 폴더> python tests/test_bk_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('BK_PACKAGE')
if not PKG:
    sys.exit('BK_PACKAGE(수집 자료 폴더)가 필요합니다')
SID = 'f754f737-104b-5eb1-a6d9-274023d60a64'
snap = json.load(open(SCR + '/fixtures/existing_state.json', encoding='utf-8'))
srv, conn = pgenv.start()
pgenv.run(conn, pgenv.PRE)
for f in sorted(glob.glob(REPO + '/supabase/migrations/*.sql')):
    if 'menu_images_bucket' in f: continue
    pgenv.run(conn, open(f, encoding='utf-8').read())
URI = srv.get_uri()

def q(sql, args=None, replica=False):
    c = psycopg2.connect(URI); c.autocommit = True
    with c.cursor() as cur:
        if replica: cur.execute("set session_replication_role = replica")
        cur.execute(sql, args)
        try: r = cur.fetchall()
        except psycopg2.ProgrammingError: r = None
    c.close(); return r

st = snap['store']
q("insert into public.categories (id, code, name) values (%s, %s, %s)", (st['category_id'], snap['_category'][0], snap['_category'][1]))
q("insert into public.stores (id, category_id, name, image_ref, is_recommended) values (%s,%s,%s,%s,%s)", (SID, st['category_id'], st['name'], st['image_ref'], st['is_recommended']))
for m in snap['menus']:
    q("insert into public.menus (id, store_id, name, description, base_price, image_ref, is_popular, popularity_score, sort_order) values (%s,%s,%s,%s,%s,%s,%s,%s,%s)",
      (m['id'], SID, m['name'], m['description'], m['base_price'], m['image_ref'], m['is_popular'], m['popularity_score'], m['sort_order']))
for g in snap['groups']:
    q("insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order) values (%s,%s,%s,%s,%s,%s)", (g['id'], g['menu_id'], g['name'], g['min_select'], g['max_select'], g['sort_order']))
for o in snap['options']:
    q("insert into public.menu_options (id, group_id, name, additional_price, sort_order) values (%s,%s,%s,%s,%s)", (o['id'], o['group_id'], o['name'], o['additional_price'], o['sort_order']))
OTHER = 'aaaaaaaa-0000-4000-8000-000000000001'
q("insert into public.stores (id, category_id, name) values (%s, %s, '다른 가게')", (OTHER, st['category_id']))
q("insert into public.menus (id, store_id, name, base_price, sort_order) values ('aaaaaaaa-0000-4000-8000-000000000002', %s, '다른 메뉴', 5000, 1)", (OTHER,))
USER = str(uuid.uuid4()); ORD = str(uuid.uuid4())
q("insert into auth.users (id) values (%s)", (USER,))
q("""insert into public.orders (id, user_id, store_id, idempotency_key, request_fingerprint, total_amount, store_name_snapshot, category_code_snapshot, category_name_snapshot,
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),11700,'버거킹','x','y',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
line = 0
oi_of = {}
for mid, n in snap['_order_items'].items():
    nm = next(m for m in snap['menus'] if m['id'] == mid)
    for _ in range(n):
        line += 1
        oid = str(uuid.uuid4()); oi_of.setdefault(mid, oid)
        q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,%s,%s,%s,0,%s,1,%s)",
          (oid, ORD, SID, mid, line, nm['name'], nm['base_price'], nm['base_price'], nm['base_price']), replica=True)
for o in snap['_oio']:
    q("insert into public.order_item_options (order_item_id, source_group_id, source_option_id, group_name_snapshot, option_name_snapshot, additional_price_snapshot, sort_order) values (%s,%s,%s,%s,%s,%s,%s)",
      (oi_of[o['menu_id']], o['source_group_id'], o['source_option_id'], o['group_name_snapshot'], o['option_name_snapshot'], o['additional_price_snapshot'], o['sort_order']), replica=True)
for mid, n in snap['_reviews'].items():
    for _ in range(n):
        q("insert into public.review_menus (review_id, menu_id) values (%s,%s)", (str(uuid.uuid4()), mid), replica=True)
REF_GROUPS = sorted({o['source_group_id'] for o in snap['_oio']})

BK = tempfile.mkdtemp(prefix='bk-test-backup-')
TOOLPARENT = tempfile.mkdtemp(prefix='bk-test-tool-')   # 승인 분기 시험용 도구 복사본(매핑 파일만 다르게). 도구가 옆 폴더의 굽네 보조 함수를 쓰므로 함께 둔다
TOOLCOPY = os.path.join(TOOLPARENT, 'burgerking')
os.makedirs(TOOLCOPY); os.makedirs(os.path.join(TOOLPARENT, 'goobne-coupangeats-20261117'))
shutil.copy(os.path.join(TOOLDIR, '..', 'goobne-coupangeats-20261117', 'import_goobne.py'), os.path.join(TOOLPARENT, 'goobne-coupangeats-20261117', 'import_goobne.py'))
for f in ('import_burgerking.py', 'menu_mapping.json', 'option_policy.json', 'menu_group_display.json'):
    shutil.copy(os.path.join(TOOLDIR, f), os.path.join(TOOLCOPY, f))
env = dict(os.environ, DATABASE_URL=URI, BK_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')

def run(*args, flags=('--sold-out-mode', 'ignore'), tool=None):
    tool = tool or os.path.join(TOOLDIR, 'import_burgerking.py')
    p = subprocess.run([sys.executable, tool, '--package', PKG, '--skip-photos', *flags, *args], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:600]))
def anon(sql, args):
    c = psycopg2.connect(URI); c.autocommit = True
    cu = c.cursor(); cu.execute('set role anon'); cu.execute(sql, args); d = cu.fetchone()[0]; c.close(); return d
fp = lambda: q("select md5(string_agg(m.id::text||m.name||m.base_price||coalesce(m.image_ref,'')||m.sort_order, ',' order by m.id)) from public.menus m where m.store_id=%s", (OTHER,))[0][0]
fp_other = fp()
cnt = lambda: tuple(q(f"select count(*) from {t}")[0][0] for t in ('public.menus', 'public.menu_option_groups', 'public.menu_options', 'public.store_menu_groups', 'public.store_menu_group_items', 'private.store_source_records'))
Y = "from public.menus where store_id=%s"

# 1) 점검·거절
rc, out = run('--check', flags=())
check('--check: 오류 없음, 연결 5·새 메뉴 117·삭제/숨김 메뉴 0, 품절 모드 미결정', rc == 0 and '오류: 없음' in out and '기존 UUID 유지 갱신 5개 + 새로 추가 117개' in out and '--sold-out-mode' in out, out[-500:])
check('점검만으로 DB 변화 없음', q("select count(*) " + Y, (SID,))[0][0] == 5)
rc, out = run('--apply', '--yes-dev-project', flags=())
check('당일 품절 처리 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) " + Y, (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) " + Y, (SID,))[0][0] == 5)

# 2) 적용(스냅샷 참조 가상 옵션은 승인 전이라 보류)
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-700:])
check('고유 활성 메뉴 122개(연결 5 + 새 117), 삭제·숨김 메뉴 없음', q("select count(*) filter (where is_active), count(*) " + Y, (SID,))[0] == (122, 122))
check('연결 5개: UUID·가격·사진·인기 유지, 설명 채움', q("select base_price, image_ref, is_popular, popularity_score, description is not null from public.menus where id='7bcddf4a-f183-5df8-a833-b0c9e5cf0e16'")[0] == (8400, 'menus/7bcddf4a-f183-5df8-a833-b0c9e5cf0e16.png', True, 70, True)
      and q("select name from public.menus where id='103fc0c0-de4b-5368-a662-c864ef8b26b4'")[0][0] == '치즈와퍼 세트')
check('옵션 그룹 138 + 보류 2, 옵션 1076 + 보류 5(스냅샷 참조 가상 옵션은 승인 전이라 비활성 보존)', q("select count(*) from public.menu_option_groups")[0][0] == 140 and q("select count(*) from public.menu_options")[0][0] == 1081
      and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 2)
check('수량 조절 0개, maxQuantity=1000 없음, 단독 옵션·합계 제한 없음', q("select count(*) filter (where allow_quantity), count(*) filter (where max_quantity is not null), count(*) filter (where is_exclusive) from public.menu_options")[0] == (0, 0, 0)
      and q("select count(*) from public.menu_option_groups where max_total_quantity is not null")[0][0] == 0)
check('필수 그룹 76개(세트 38개), 선택 그룹은 필수 아님', q("select count(*) filter (where min_select >= 1), count(distinct menu_id) filter (where min_select >= 1) from public.menu_option_groups where is_active and menu_id in (select id from public.menus where store_id=%s)", (SID,))[0] == (76, 38))
check('메뉴 그룹 9개·소속 126개(고유 메뉴 122), 더 크리스퍼 4개는 두 그룹', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 9 and q("select count(*), count(distinct menu_id) from public.store_menu_group_items where store_id=%s", (SID,))[0] == (126, 122)
      and q("select count(*) from (select menu_id from public.store_menu_group_items where store_id=%s group by 1 having count(*) > 1) x", (SID,))[0][0] == 4)
check('주문·리뷰 스냅샷 보존, 다른 가게 불변', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 13 and q("select count(*) from public.order_item_options")[0][0] == 2 and q("select count(*) from public.review_menus")[0][0] == 7 and fp() == fp_other)
check('내부 기록: 당일 품절 2개는 원본 상태·수집 시점·앱 표시 결정을 구분', q("select count(*) from private.store_source_records where load_batch like 'burgerking%%' and collected_for='MENU_PRICE' and note like '%%SOLD_OUT_TODAY%%(수집 시점 2026-11-19)%%앱 표시 결정%%확인된 사실이 아님%%'")[0][0] == 2)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
check('Guest get_store: 그룹 9개 이름·순서·소속 수', [(g['name'], len(g['menuIds'])) for g in d['menuGroups']] == [('신제품(NEW)', 26), ('와퍼 세트', 9), ('와퍼주니어 세트', 6), ('씨푸드, 비프, 치킨버거 세트', 12), ('와퍼', 9), ('와퍼주니어', 6), ('씨푸드, 비프, 치킨버거', 12), ('사이드', 32), ('음료&디저트', 14)], [(g['name'], len(g['menuIds'])) for g in d['menuGroups']])
check('Guest get_store: menus 122개 중복 없음, 소속 합 126, 첫 메뉴는 원본 첫 메뉴', len(d['menus']) == 122 and len({m['id'] for m in d['menus']}) == 122 and sum(len(g['menuIds']) for g in d['menuGroups']) == 126 and d['menus'][0]['name'] == '쯔란로제 크리스퍼')
idm = json.load(open(TOOLDIR + '/id_map.json'))
ws = anon('select public.get_menu(%s::uuid)', (idm['menus']['22086362'],))
check('와퍼 세트: 필수 그룹 2개(세트 사이드 교환·세트 음료 교환1)+선택 컨디먼트, 수량·단독·합계 필드 없음, 가상 옵션이 안 보임', [(g['name'].strip(), g['minSelect'], g['maxSelect']) for g in ws['optionGroups']] == [('세트 사이드 교환', 1, 1), ('세트 음료 교환1', 1, 1), ('컨디먼트 추가 선택', 0, 1000)]
      and all(o.get('maxQuantity') is None and not o.get('isExclusive') for g in ws['optionGroups'] for o in g['options']) and all(g.get('maxTotalQuantity') is None for g in ws['optionGroups']), [(g['name'], g['minSelect']) for g in ws['optionGroups']])
check('세트 사이드 교환 추가금·선택지 순서 보존(프렌치프라이R 0원이 첫 번째, 딥 트러플 프라이 +700원)', ws['optionGroups'][0]['options'][0]['name'].strip() == '프렌치프라이R' and ws['optionGroups'][0]['options'][0]['additionalPrice'] == 0
      and any(o['additionalPrice'] == 700 for o in ws['optionGroups'][0]['options']))
if os.environ.get('BK_DUMP'):
    json.dump([anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']], open(os.environ['BK_DUMP'], 'w'), ensure_ascii=False)
    json.dump(d, open(os.environ['BK_DUMP'] + '.store.json', 'w'), ensure_ascii=False)

# 4) 재실행·검증
before = cnt()
rc, out = run('--apply', '--yes-dev-project')
check('재실행 성공·중복 없음', rc == 0 and cnt() == before, (rc, cnt(), before, out[-300:]))
rc, out = run('--verify')
check('--verify 통과', rc == 0 and 'FAIL' not in out, out[-400:])

# 5) 복구
bks = sorted(x for x in os.listdir(BK) if x not in pre_dirs)
first = os.path.join(BK, bks[0])
bkj = json.load(open(first + '/backup.json'))
check('첫 적용 전 백업은 복구 기준, 재실행 백업은 기준 아님', bkj['applied_before_backup'] == [] and json.load(open(os.path.join(BK, bks[-1]) + '/backup.json'))['applied_before_backup'] != [])
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt and 'sb_secret' not in bt)
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', first)
check('복구 성공', rc == 0 and 'FAIL' not in out, out[-600:])
check('복구 후: 원래 메뉴 5개·옵션 그룹 4·옵션 10, 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) filter (where is_active) " + Y, (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 4
      and q("select count(*) from public.menu_options")[0][0] == 10 and q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'burgerking%%'")[0][0] == 0 and fp() == fp_other)

# 6) 서정 승인 뒤: 스냅샷이 가리키는 가상 그룹도 삭제(원본 ID 대응 백업), 나머지는 같음
mp = json.load(open(os.path.join(TOOLCOPY, 'menu_mapping.json'), encoding='utf-8'))
mp['approved_snapshot_referenced_group_ids'] = REF_GROUPS
json.dump(mp, open(os.path.join(TOOLCOPY, 'menu_mapping.json'), 'w', encoding='utf-8'), ensure_ascii=False)
pre2 = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project', tool=os.path.join(TOOLCOPY, 'import_burgerking.py'))
check('승인된 스냅샷 참조 가상 그룹 삭제: 옵션 그룹 138·옵션 1076, 보류 없음, 스냅샷 행은 그대로', rc == 0 and q("select count(*) from public.menu_option_groups")[0][0] == 138 and q("select count(*) from public.menu_options")[0][0] == 1076
      and q("select count(*) from public.order_item_options")[0][0] == 2 and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 0, out[-500:])
new_dirs = sorted(x for x in os.listdir(BK) if x not in pre2)
smap = json.load(open(os.path.join(BK, new_dirs[0], 'snapshot_source_id_map.json')))
check('백업에 원본 ID ↔ 스냅샷 대응 기록', len(smap['snapshot_rows_referencing_deleted']) == 2, list(smap))
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True); shutil.rmtree(TOOLPARENT, ignore_errors=True)
sys.exit(0 if all(results) else 1)
