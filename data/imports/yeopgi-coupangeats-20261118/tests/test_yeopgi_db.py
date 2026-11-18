# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해 적용·재실행·복구·실패 경로를 시험한다.
실행: YEOPGI_PACKAGE=<수집 폴더> python tests/test_yeopgi_db.py   (pip install pgserver psycopg2-binary; 실서버에는 연결하지 않는다)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('YEOPGI_PACKAGE')  # 수집 자료 폴더(저장소 밖, 읽기 전용)
if not PKG:
    sys.exit('YEOPGI_PACKAGE(수집 자료 폴더)가 필요합니다')
TOOL = TOOLDIR + '/import_yeopgi.py'
SID = '028512ff-e033-53c3-a30f-a3e7f18862f1'
snap = json.load(open(SCR + '/fixtures/existing_state.json', encoding='utf-8'))
srv, conn = pgenv.start()
pgenv.run(conn, pgenv.PRE)
MIGS = sorted(glob.glob(REPO + '/supabase/migrations/*.sql'))
for f in MIGS:
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
q("insert into public.categories (id, code, name) values (%s, 'snack', '분식')", (st['category_id'],))
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
# 주문 스냅샷: 엽기메뉴 + 매운맛 옵션(원본 ID가 가상 옵션을 가리킴)
YM = '6bfda566-c644-5c1d-a75c-c03a5d315a62'
USER = str(uuid.uuid4()); ORD = str(uuid.uuid4()); OI = str(uuid.uuid4())
q("insert into auth.users (id) values (%s)", (USER,))
q("""insert into public.orders (id, user_id, store_id, idempotency_key, request_fingerprint, total_amount, store_name_snapshot, category_code_snapshot, category_name_snapshot,
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),14000,'동대문엽기떡볶이','snack','분식',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,1,'엽기메뉴',14000,0,14000,1,14000)", (OI, ORD, SID, YM), replica=True)
o = snap['_oio'][0]
q("insert into public.order_item_options (order_item_id, source_group_id, source_option_id, group_name_snapshot, option_name_snapshot, additional_price_snapshot, sort_order) values (%s,%s,%s,%s,%s,%s,%s)",
  (OI, o['source_group_id'], o['source_option_id'], o['group_name_snapshot'], o['option_name_snapshot'], o['additional_price_snapshot'], o['sort_order']), replica=True)

BK = tempfile.mkdtemp(prefix='yeopgi-test-backup-')
env = dict(os.environ, DATABASE_URL=URI, YEOPGI_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')

def run(*args, extra=()):
    p = subprocess.run([sys.executable, TOOL, '--package', PKG, '--skip-photos', *extra, *args], env=env, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr

results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:600]))

def anon_store():
    c = psycopg2.connect(URI); c.autocommit = True
    cu = c.cursor(); cu.execute('set role anon'); cu.execute('select public.get_store(%s::uuid)', (SID,)); d = cu.fetchone()[0]; c.close(); return d
def anon_menu(mid):
    c = psycopg2.connect(URI); c.autocommit = True
    cu = c.cursor(); cu.execute('set role anon'); cu.execute('select public.get_menu(%s::uuid)', (mid,)); d = cu.fetchone()[0]; c.close(); return d

def fp():
    return q("select md5(string_agg(m.id::text||m.name||m.base_price||coalesce(m.image_ref,'')||m.sort_order, ',' order by m.id)) from public.menus m where m.store_id=%s", (OTHER,))[0][0]
fp_other = fp()

# 1) 점검(읽기 전용)
rc, out = run('--check')
check('--check 오류 없음·보고서', rc == 0 and '오류: 없음' in out and '삭제 예정: 그룹 9개, 옵션 18개' in out and '비활성으로 보존: 그룹 1개, 옵션 2개' in out, out[:600])
check('점검만으로 DB 변화 없음', q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5)
# 2) 상한 미결정이면 적용 거절
rc, out = run('--apply', '--yes-dev-project')
check('수량 상한 미결정이면 적용을 거절한다', rc != 0 and '미결정' in out and q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5, out[-200:])
# 3) 참조가 있는 삭제 대상은 막는다
RM = '95d7d9e9-7e35-5331-a202-2b18e309c1d1'
RM_OI = str(uuid.uuid4())
q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,2,'2인',9000,0,9000,1,9000)", (RM_OI, ORD, SID, RM), replica=True)
rc, out = run('--apply', '--yes-dev-project', extra=('--option-max-quantity', '10'))
check('삭제 대상 메뉴를 가리키는 주문이 있으면 전체 되돌림', rc != 0 and '참조' in out and q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5
      and q("select count(*) from public.menu_option_groups")[0][0] == 10, out[-400:])
q("delete from public.order_items where id=%s", (RM_OI,), replica=True)

# 4) 적용
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project', extra=('--option-max-quantity', '10'))
print(out[-2600:])
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-500:])
check('활성 메뉴 35개, 2인 엽기떡볶이 삭제', q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 35 and q("select count(*) from public.menus where id=%s", (RM,))[0][0] == 0)
check('옵션 그룹 43 + 보존 비활성 1, 옵션 268 + 보존 2', q("select count(*) from public.menu_option_groups")[0][0] == 44 and q("select count(*) from public.menu_options")[0][0] == 270)
check('수량 옵션 106개 상한 10, 나머지 수량 없음', q("select count(*) filter (where allow_quantity and max_quantity=10), count(*) filter (where allow_quantity), count(*) filter (where not allow_quantity and max_quantity is null) from public.menu_options where is_active")[0] == (106, 106, 162))
check('원본 max 1000이 앱 상한으로 쓰이지 않음', q("select count(*) from public.menu_options where max_quantity > 10")[0][0] == 0)
check('메뉴 그룹 7개·소속 35', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 7 and q("select count(*) from public.store_menu_group_items where store_id=%s", (SID,))[0][0] == 35)
check('주문·리뷰 스냅샷 보존(주문 항목·옵션 스냅샷 그대로)', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 1 and q("select count(*) from public.order_item_options")[0][0] == 1)
check('다른 가게 불변', fp() == fp_other)
check('엽기메뉴: 기존 UUID·인기·사진·설명 채움', q("select name, is_popular, popularity_score, image_ref, description is not null from public.menus where id=%s", (YM,))[0] == ('엽기메뉴', True, 60, 'menus/6bfda566-c644-5c1d-a75c-c03a5d315a62.png', True))

# 5) Guest 응답
d = anon_store()
check('Guest get_store: 그룹 7개 이름·순서', [g['name'] for g in d['menuGroups']] == ['세트메뉴', '메인메뉴', '닭볶음탕', '엽기 닭발메뉴', '밀키트', '사이드', '음료'], [g['name'] for g in d['menuGroups']])
check('Guest get_store: 활성 메뉴 35개이고 menus 순서 = 그룹 순서(기존/신규 구분 없음)', len(d['menus']) == 35 and [m['id'] for m in d['menus']] == [i for g in d['menuGroups'] for i in g['menuIds']])
check('메인메뉴 안 순서: 엽기→로제→마라→마라로제(기존 메뉴가 앞에 몰리지 않고 원본 순서)', [next(m['name'] for m in d['menus'] if m['id'] == i) for i in d['menuGroups'][1]['menuIds']] == ['엽기메뉴', '로제메뉴', '마라떡볶이', '마라로제떡볶이'])
check('첫 메뉴는 실속세트(세트메뉴 첫 번째)', d['menus'][0]['name'] == '실속세트')
m = anon_menu(YM)
names = [g['name'] for g in m['optionGroups']]
check('엽기메뉴 옵션: 실제 4그룹만 보이고 가상 옵션(맵기 선택·추가 토핑)이 안 보인다', len(names) == 4 and '맵기 선택' not in names and '추가 토핑' not in names, names)
req = [g['name'] for g in m['optionGroups'] if g['minSelect'] >= 1]
check('엽기메뉴 필수: 메뉴 선택 1·맛 선택 1', req == ['메뉴 선택 1', '맛 선택 1'], req)
qty = [(o['name'], o['maxQuantity']) for g in m['optionGroups'] for o in g['options'] if o.get('maxQuantity')]
check('엽기메뉴 수량 옵션 8개, 상한 10', len(qty) == 8 and all(x[1] == 10 for x in qty), qty)
nopt = anon_menu(json.load(open(TOOLDIR + '/id_map.json'))['menus']['33048438'])
check('옵션 없는 사이드(참치마요밥)는 optionGroups 비어 있음', nopt['optionGroups'] == [] and nopt['price'] == 3500)
ms = anon_menu(json.load(open(TOOLDIR + '/id_map.json'))['menus']['39895615'])
check('밀키트: 필수 그룹 2개(맛 선택 4·5) + 선택 그룹 1개(맛 선택 6, 최대 1000)', sorted((g['name'], g['minSelect'], g['maxSelect']) for g in ms['optionGroups']) == [('맛 선택 4', 1, 1), ('맛 선택 5', 1, 1), ('맛 선택 6', 0, 1000)], [(g['name'], g['minSelect'], g['maxSelect']) for g in ms['optionGroups']])

# 6) 재실행: 중복 없음
cnt = lambda: tuple(q(f"select count(*) from {t}")[0][0] for t in ('public.menus', 'public.menu_option_groups', 'public.menu_options', 'public.store_menu_groups', 'public.store_menu_group_items', 'private.store_source_records'))
before = cnt()
rc, out = run('--apply', '--yes-dev-project', extra=('--option-max-quantity', '10'))
check('재실행 성공·중복 없음', rc == 0 and cnt() == before, (rc, cnt(), before, out[-300:]))
# 7) 검증 단독
rc, out = run('--verify', extra=('--option-max-quantity', '10'))
print(out[:1500])
check('--verify 통과', rc == 0 and 'FAIL' not in out, out[-400:])
# 8) 복구: 최초 적용 전 백업(…-pre-apply 중 가장 이른 것)으로 되돌림
bks = sorted(d for d in os.listdir(BK) if d not in pre_dirs)
first = os.path.join(BK, bks[0])
bkj = json.load(open(first + '/backup.json'))
check('첫 적용 전 백업은 복구 기준(applied_before_backup 비어 있음), 두 번째(재실행) 백업은 기준 아님', bkj['applied_before_backup'] == [] and json.load(open(os.path.join(BK, bks[-1]) + '/backup.json'))['applied_before_backup'] != [], bks)
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt and 'sb_secret' not in bt, [k for k in ('postgresql://','eyJ','sb_secret') if k in bt])
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', os.path.join(BK, bks[-1]))
check('재실행 시점 백업으로는 복구 거절', rc != 0 and '복구 기준이 아닙니다' in out, out[-200:])
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', first)
print(out[-800:])
check('복구 성공', rc == 0 and 'FAIL' not in out, out[-500:])
check('복구 후: 원래 메뉴 5개·옵션 그룹 10·옵션 20', q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 10 and q("select count(*) from public.menu_options")[0][0] == 20)
check('복구 후: 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'yeopgi%%'")[0][0] == 0 and fp() == fp_other)
check('복구 후: 2인 엽기떡볶이와 그 옵션 복원', q("select count(*) from public.menus where id=%s", (RM,))[0][0] == 1 and q("select count(*) from public.menu_option_groups where menu_id=%s", (RM,))[0][0] == 2)
# 9) 복구 후 재적용
rc, out = run('--apply', '--yes-dev-project', extra=('--option-max-quantity', '10'))
check('복구 후 재적용 성공', rc == 0 and q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 35, out[-300:])
# 10) 비밀값이 출력에 없다
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True)
sys.exit(0 if all(results) else 1)
