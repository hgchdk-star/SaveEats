# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해
미결정 거절·적용·Guest 응답·그룹 중복 소속·필수 수량형 그룹·재실행·복구를 시험한다. 실서버에는 연결하지 않는다.
실행: BAEK_PACKAGE=<수집 폴더> python tests/test_baek_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('BAEK_PACKAGE')
if not PKG:
    sys.exit('BAEK_PACKAGE(수집 자료 폴더)가 필요합니다')
TOOL = TOOLDIR + '/import_baeksojeong.py'
SID = '80b4c10d-a815-51d9-add1-e10cc962cf37'
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
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),15500,'백소정','x','y',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
line = 0
for mid, n in snap['_order_items'].items():
    nm = next(m for m in snap['menus'] if m['id'] == mid)
    for _ in range(n):
        line += 1
        q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,%s,%s,%s,0,%s,1,%s)",
          (str(uuid.uuid4()), ORD, SID, mid, line, nm['name'], nm['base_price'], nm['base_price'], nm['base_price']), replica=True)
for mid in snap['_reviews']:
    q("insert into public.review_menus (review_id, menu_id) values (%s,%s)", (str(uuid.uuid4()), mid), replica=True)

BK = tempfile.mkdtemp(prefix='baek-test-backup-')
env = dict(os.environ, DATABASE_URL=URI, BAEK_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')
FLAGS = ('--option-max-quantity', '10', '--group-names', 'proposed', '--group-total-mode', 'source-max', '--none-option-mode', 'no-quantity', '--review-event-groups', 'hidden')

def run(*args, flags=FLAGS):
    p = subprocess.run([sys.executable, TOOL, '--package', PKG, '--skip-photos', *flags, *args], env=env, capture_output=True, text=True)
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
check('--check: 미결정 4개와 삭제 1·숨김 0, 연결 4', rc == 0 and out.count('(--') >= 3 and '삭제 1개, 숨김 보존 0개' in out and '기존 UUID 유지 갱신 4개 + 새로 추가 62개' in out, out[-700:])
check('점검만으로 DB 변화 없음', q("select count(*) " + Y, (SID,))[0][0] == 5)
base = {'--option-max-quantity': '10', '--group-names': 'proposed', '--group-total-mode': 'source-max', '--none-option-mode': 'no-quantity', '--review-event-groups': 'hidden'}
for drop, label in (('--group-total-mode', '수량 합계'), ('--none-option-mode', '선택안함'), ('--review-event-groups', '리뷰이벤트'), ('--group-names', '표시명'), ('--option-max-quantity', '수량 상한')):
    fl = tuple(x for k, v in base.items() if k != drop for x in (k, v))
    rc, out = run('--apply', '--yes-dev-project', flags=fl)
    check(f'{label} 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) " + Y, (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) " + Y, (SID,))[0][0] == 5)

# 2) 적용(권장 결정)
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-700:])
check('고유 활성 메뉴 66개, 돈카츠(등심카츠) 삭제', q("select count(*) filter (where is_active), count(*) " + Y, (SID,))[0] == (66, 66) and q("select count(*) from public.menus where id='10182e20-f953-543b-a5e0-f0d0b3b345fe'")[0][0] == 0)
check('연결 4개는 UUID 유지·가격 갱신·사진 유지·인기 보존, 에비텐 메뉴는 수집본 이름으로 맞추고 과거 주문 스냅샷 이름은 그대로', q("select base_price, image_ref, is_popular, popularity_score from public.menus where id='f040c9aa-6d3b-5173-a61c-f74746c07ee7'")[0] == (15900, 'menus/f040c9aa-6d3b-5173-a61c-f74746c07ee7.png', True, 20)
      and q("select base_price, name from public.menus where id='a20ccb38-f475-5f66-abc6-9020d1e52ad7'")[0] == (16500, '에비텐 어묵우동+돈카츠')
      and q("select count(*) from public.order_items where menu_id='a20ccb38-f475-5f66-abc6-9020d1e52ad7' and menu_name_snapshot='에비텐어묵우동+돈카츠'")[0][0] == 7)
check('옵션 그룹 145·옵션 1078(기존 가상 옵션 전부 삭제)', q("select count(*) from public.menu_option_groups")[0][0] == 145 and q("select count(*) from public.menu_options")[0][0] == 1078)
check('메뉴 그룹 12개·소속 69개(고유 메뉴 66)', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 12 and q("select count(*), count(distinct menu_id) from public.store_menu_group_items where store_id=%s", (SID,))[0] == (69, 66))
check('같은 메뉴가 BEST 메뉴·단품메뉴에 모두 있고 본체는 하나', q("select count(*) from public.menus where store_id=%s and name='마제소바'", (SID,))[0][0] == 1 and q("select count(*) from public.store_menu_group_items i join public.menus m on m.id=i.menu_id where m.name in ('마제소바','돈카츠(로스카츠)','모짜렐라 치즈카츠') and i.store_id=%s", (SID,))[0][0] == 6)
check('수량 조절 15개(선택안함 5개 제외), 상한 8(10으로 덮어쓰지 않음), 합계 상한 8은 필수 그룹 5개만', q("select count(*) filter (where allow_quantity), count(*) filter (where allow_quantity and max_quantity=8), count(*) filter (where max_quantity>8) from public.menu_options")[0] == (15, 15, 0)
      and q("select count(*) filter (where max_total_quantity=8), count(*) filter (where max_total_quantity is not null) from public.menu_option_groups")[0] == (5, 5))
check('리뷰이벤트 그룹 54개는 비활성(행은 보존), 나머지 그룹은 활성', q("select count(*) filter (where not is_active), count(*) filter (where not is_active and name like '리뷰이벤트%%') from public.menu_option_groups")[0] == (54, 54))
check('원본 그룹명은 source_name에 보존, 표시명 정리', q("select name, source_name from public.store_menu_groups where sort_order=4")[0] == ('세트 메뉴', '세트 메뉴 [최대 1,500원 할인]'))
check('내부 기록: 원본 수량 범위·선택안함·리뷰이벤트 처리', q("select count(*) from private.store_source_records where load_batch like 'baek%%' and subject_label like '%%수량%%'")[0][0] >= 1)
check('주문·리뷰 스냅샷 보존, 다른 가게 불변', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 8 and q("select count(*) from public.review_menus")[0][0] == 1 and fp() == fp_other)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
check('Guest get_store: 그룹 12개 이름·순서(표시명)', [g['name'] for g in d['menuGroups']] == ['배달전용메뉴', "기본에 충실한 '키소 냉소바'", "'면' 대신 '밥' 마제동", '푸짐하게 즐기는 (특) 시리즈', '세트 메뉴', 'BEST 메뉴', '고기듬뿍 풍미듬뿍 프리미엄카레', '기본에 충실한 카레', '단품메뉴', '든든한 한 끼 덮밥', '겨울철 생각나는 뜨끈한 우동', '추가메뉴'], [g['name'] for g in d['menuGroups']])
check('Guest get_store: menus 66개(중복 없음), 그룹 소속 합 69', len(d['menus']) == 66 and len({m['id'] for m in d['menus']}) == 66 and sum(len(g['menuIds']) for g in d['menuGroups']) == 69)
idm = json.load(open(TOOLDIR + '/id_map.json'))
kc = anon('select public.get_menu(%s::uuid)', (idm['menus']['124518679'],))
req = [g for g in kc['optionGroups'] if g['minSelect'] >= 1]
check('키소카레: 필수 그룹 1개(종류 1~8·합계 8), 선택안함은 수량 조절 없음, 나머지 3종은 상한 8', len(req) == 1 and req[0]['maxSelect'] == 8 and req[0]['maxTotalQuantity'] == 8
      and [(o['name'], o.get('maxQuantity')) for o in req[0]['options']] == [('선택안함', None), ('대파', 8), ('마늘양파후레이크', 8), ('눈꽃치즈', 8)], [(o['name'], o.get('maxQuantity')) for o in req[0]['options']])
check('리뷰이벤트 그룹은 앱 응답에 없다', not any(g['name'].startswith('리뷰이벤트') for g in kc['optionGroups']), [g['name'] for g in kc['optionGroups']])
if os.environ.get('BAEK_DUMP'):
    json.dump(d, open(os.environ['BAEK_DUMP'] + '.store.json', 'w'), ensure_ascii=False)
    json.dump([anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']], open(os.environ['BAEK_DUMP'], 'w'), ensure_ascii=False)

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
check('복구 후: 원래 메뉴 5개·옵션 그룹 2·옵션 5, 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) filter (where is_active) " + Y, (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 2
      and q("select count(*) from public.menu_options")[0][0] == 5 and q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'baek%%'")[0][0] == 0 and fp() == fp_other)

# 6) 다른 결정: 원본 그대로(선택안함 수량 20개, 합계 제한 없음, 리뷰이벤트 노출)
rc, out = run('--apply', '--yes-dev-project', flags=('--option-max-quantity', '10', '--group-names', 'source', '--group-total-mode', 'none', '--none-option-mode', 'source', '--review-event-groups', 'import'))
check('원본 그대로 모드: 수량 20개·합계 제한 없음·리뷰이벤트 노출·그룹명 원본', rc == 0 and q("select count(*) filter (where allow_quantity) from public.menu_options")[0][0] == 20
      and q("select count(*) from public.menu_option_groups where max_total_quantity is not null")[0][0] == 0 and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 0
      and q("select name from public.store_menu_groups where sort_order=4")[0][0] == '세트 메뉴 [최대 1,500원 할인]', out[-400:])
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True)
sys.exit(0 if all(results) else 1)
