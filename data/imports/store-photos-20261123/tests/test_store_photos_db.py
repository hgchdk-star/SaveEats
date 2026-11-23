# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체를 올리고 16개 가게를 흉내 내 적용 도구를 시험한다(실서버 연결 없음).
가게 독립 실행(한 가게 보류·업로드 실패 시 나머지 계속), 대표=첫 장, 장수·순서, Guest 응답(구버전 imageRef 유지), 목록 응답에 photos 없음,
메뉴·주문·스냅샷·다른 가게 불변, 재실행 중복 없음, 복구를 확인한다.
실행: STORE_PHOTOS_PACKAGE=<수집 폴더> python tests/test_store_photos_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, glob, shutil, tempfile, uuid, importlib.util
SCR = os.path.dirname(os.path.abspath(__file__)); TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('STORE_PHOTOS_PACKAGE') or sys.exit('STORE_PHOTOS_PACKAGE가 필요합니다')
M = json.load(open(os.path.join(TOOLDIR, 'stores_map.json'), encoding='utf-8'))['stores']
srv, conn = pgenv.start(); pgenv.run(conn, pgenv.PRE)
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
def anon(sql, args):
    c = psycopg2.connect(URI); c.autocommit = True
    cu = c.cursor(); cu.execute('set role anon'); cu.execute(sql, args); d = cu.fetchone()[0]; c.close(); return d
CAT = str(uuid.uuid4())
q("insert into public.categories (id, code, name) values (%s, 'zz-t', '시험')", (CAT,))
OLD = {}
for s in M:
    OLD[s['key']] = f'stores/{s["store_id"]}.png'
    q("insert into public.stores (id, category_id, name, image_ref, is_recommended) values (%s,%s,%s,%s,true)", (s['store_id'], CAT, s['store_name'], OLD[s['key']]))
    q("insert into public.menus (id, store_id, name, base_price, sort_order, image_ref) values (%s,%s,'메뉴',5000,1,%s)", (str(uuid.uuid4()), s['store_id'], 'menus/' + str(uuid.uuid4()) + '.png'))
USER = str(uuid.uuid4()); ORD = str(uuid.uuid4()); S0 = M[0]['store_id']
q("insert into auth.users (id) values (%s)", (USER,))
q("""insert into public.orders (id, user_id, store_id, idempotency_key, request_fingerprint, total_amount, store_name_snapshot, store_image_snapshot, category_code_snapshot, category_name_snapshot,
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),5000,'x',%s,'x','y',%s,'v1',now())""", (ORD, USER, S0, str(uuid.uuid4()), OLD[M[0]['key']], str(uuid.uuid4())), replica=True)
mid = q("select id::text from public.menus where store_id=%s", (S0,))[0][0]
q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,1,'메뉴',5000,0,5000,1,5000)", (str(uuid.uuid4()), ORD, S0, mid), replica=True)

BK = tempfile.mkdtemp(prefix='store-photos-test-backup-'); os.environ.update(DATABASE_URL=URI, STORE_PHOTOS_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_SERVICE_ROLE_KEY='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='')
spec = importlib.util.spec_from_file_location('isp', os.path.join(TOOLDIR, 'import_store_photos.py')); isp = importlib.util.module_from_spec(spec); spec.loader.exec_module(isp)
results = []
def check(name, ok, detail=''):
    results.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + name + ('' if ok else '  -> ' + str(detail)[:500]))
def run(*args, pkg=PKG):
    sys.argv = ['x', '--package', pkg, '--skip-photos', *args]
    try: isp.main(); return 0
    except SystemExit as e: return e.code or 0
fp = lambda: q("select md5(string_agg(m.id::text||m.name||m.base_price||coalesce(m.image_ref,''), ',' order by m.id)) from public.menus m")[0][0]
ofp = lambda: q("select md5(string_agg(concat_ws('|',oi.id,oi.menu_name_snapshot,oi.unit_price), ',' order by oi.id) || (select store_image_snapshot from public.orders limit 1)) from public.order_items oi")[0][0]
menus0, order0 = fp(), ofp()

# 1) 점검: 16곳 UUID·이름 일치, 수집 파일 해시·경로 규칙 통과
rc = run('--check')
check('--check 통과(16곳, 66장)', rc == 0 and sum(len(s['photos']) for s in M) == 66)
check('점검만으로 DB 변화 없음', q("select count(*) from public.store_photos")[0][0] == 0)
rc = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) from public.store_photos")[0][0] == 0)

# 2) 한 가게 보류(수집 파일 누락)해도 나머지 15곳은 계속
tmp = tempfile.mkdtemp(prefix='sp-pkg-'); shutil.copytree(PKG, os.path.join(tmp, 'p'))
broken = M[3]; os.remove(os.path.join(tmp, 'p', broken['photos'][1]['local_path']))
rc = run('--apply', '--yes-dev-project', pkg=os.path.join(tmp, 'p'))
check(f'파일이 빠진 {broken["store_name"]}만 보류(DB 변경 없음), 나머지 15곳은 적용', rc != 0 and q("select count(*) from public.store_photos where store_id=%s", (broken['store_id'],))[0][0] == 0
      and q("select image_ref from public.stores where id=%s", (broken['store_id'],))[0][0] == OLD[broken['key']] and q("select count(distinct store_id) from public.store_photos")[0][0] == 15)
shutil.rmtree(tmp)

# 3) 업로드 실패 시 그 가게의 DB 변경 전에 멈춘다(나머지 계속)
orig_upload, orig_req = isp.G.upload_photos, isp.G.storage_request
fail_key = M[5]
def fake_upload(plan):
    ps = [p['object_path'] for p in plan['photos']]
    if ps and ps[0].startswith('stores/' + fail_key['store_id']): return [], [(ps[0], 500, '시험용 실패')]
    return ps, []
isp.G.upload_photos = fake_upload; isp.G.storage_request = lambda *a, **k: (200, b'')
orig_main_backup = isp.backup
isp.backup = lambda plan, cur, d, fetch=True: orig_main_backup(plan, cur, d, False)
q("delete from public.store_photos"); q("update public.stores set image_ref = 'stores/' || id::text || '.png'"); q("delete from private.store_source_records")
isp.anon_verify = lambda plan: True
sys.argv = ['x', '--package', PKG, '--apply', '--yes-dev-project']
try: isp.main(); rc = 0
except SystemExit as e: rc = e.code or 0
check(f'업로드 실패한 {fail_key["store_name"]}은 DB 변경 없이 멈추고 나머지 15곳은 적용', rc != 0 and q("select count(*) from public.store_photos where store_id=%s", (fail_key['store_id'],))[0][0] == 0
      and q("select image_ref from public.stores where id=%s", (fail_key['store_id'],))[0][0] == OLD[fail_key['key']] and q("select count(distinct store_id) from public.store_photos")[0][0] == 15)
isp.G.upload_photos, isp.G.storage_request = orig_upload, orig_req
isp.backup = orig_main_backup

# 4) 전체 적용(건너뛴 1곳 포함) — 사진 업로드는 건너뛰고 DB·Guest 규칙만 확인
q("delete from public.store_photos"); q("update public.stores set image_ref = 'stores/' || id::text || '.png'"); q("delete from private.store_source_records")
rc = run('--apply', '--yes-dev-project')
check('16곳 적용 성공(가게마다 트랜잭션 안 검증 통과)', rc == 0, rc)
check('사진 66장·가게 16곳', q("select count(*), count(distinct store_id) from public.store_photos")[0] == (66, 16))
ok_all = True; reps = []
for s in M:
    d = anon('select public.get_store(%s::uuid)', (s['store_id'],))
    rows = [p['imageRef'] for p in d['photos']]
    exp = [p['object_path'] for p in s['photos']]
    rep_pos = s['representative_source_position']
    ok = rows == exp and d['imageRef'] == exp[0] and s['photos'][0]['source_position'] == rep_pos and [p['source_position'] for p in s['photos'][1:]] == sorted(p['source_position'] for p in s['photos'][1:]) \
        and rep_pos not in [p['source_position'] for p in s['photos'][1:]] and len(rows) == len(s['photos']) and all(isp.APP_PATH.match(r) for r in rows)
    ok_all &= ok; reps.append((s['key'], rep_pos, len(rows)))
    if not ok: print('   불일치', s['key'], rows[:2], exp[:2])
check('Guest get_store: 가게 16곳의 imageRef = photos[0](대표), 장수·원본 순서가 계획과 같다', ok_all)
check('대표 번호: 굽네 4번·도미노 2번·나머지 14곳 1번', {k: p for k, p, n in reps if p != 1} == {'goobne': 4, 'domino': 2})
check('갤러리 장수(원본 장수와 같다)', [n for _, _, n in reps] == [len(s['photos']) for s in M] and sum(n for _, _, n in reps) == 66)
lst = anon("select public.list_stores(%s::uuid, null, 50)::text", (CAT,))
check('목록 응답(list_stores)에는 photos가 없고 imageRef 한 장만 있다', 'photos' not in lst and all(f'-{s["photos"][0]["sha256"][:8]}.jpg' in lst for s in M))
check('메뉴·가격·주문·스냅샷(주문의 가게 이미지 스냅샷 포함) 변경 없음', fp() == menus0 and ofp() == order0)
check('기존 stores/<UUID>.<확장자> 파일 경로는 주문 스냅샷에 그대로 남아 있다(파일은 지우지 않음)', q("select store_image_snapshot from public.orders")[0][0] == OLD[M[0]['key']])
n_rec = q("select count(*) from private.store_source_records where load_batch=%s and rights_permission='미확인'", ('store-photos-coupangeats-20261123',))[0][0]
check('출처 기록 66건(원본 위치·권한 미확인)', n_rec == 66, n_rec)

# 5) 재실행·검증
before = (q("select count(*) from public.store_photos")[0][0], q("select count(*) from private.store_source_records")[0][0], q("select md5(string_agg(id::text, ',' order by id)) from public.store_photos")[0][0])
rc = run('--apply', '--yes-dev-project')
after = (q("select count(*) from public.store_photos")[0][0], q("select count(*) from private.store_source_records")[0][0], q("select md5(string_agg(id::text, ',' order by id)) from public.store_photos")[0][0])
check('재실행 성공·중복 없음(행 수·id 동일)', rc == 0 and before == after, (before, after))
check('--verify 통과(쓰기 없음)', run('--verify') == 0)

# 6) 복구: 최초 적용 전 백업 기준으로 가게 하나
key = M[6]['key']; sid = M[6]['store_id']
bdirs = sorted(os.listdir(os.path.join(BK, key)))
first = os.path.join(BK, key, bdirs[0]); bk = json.load(open(first + '/backup.json'))
check('첫 적용 전 백업은 복구 기준(기존 갤러리 행 없음), 재실행 백업은 기준 아님', bk['applied_before_backup'] == [] and json.load(open(os.path.join(BK, key, bdirs[-1], 'backup.json')))['applied_before_backup'] != [])
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt)
rc = run('--restore', '--stores', key, '--backup-dir', os.path.join(BK, key, bdirs[-1]))
check('적용 뒤에 만든 백업으로는 복구를 거절', rc != 0 and q("select count(*) from public.store_photos where store_id=%s", (sid,))[0][0] == len(M[6]['photos']))
rc = run('--restore', '--yes-dev-project', '--stores', key, '--backup-dir', first)
check('복구 성공: 기존 대표사진 연결·갤러리 0장·출처 기록 삭제, 다른 가게는 그대로', rc == 0 and q("select image_ref from public.stores where id=%s", (sid,))[0][0] == OLD[key]
      and q("select count(*) from public.store_photos where store_id=%s", (sid,))[0][0] == 0 and q("select count(*) from private.store_source_records where store_id=%s", (sid,))[0][0] == 0
      and q("select count(distinct store_id) from public.store_photos")[0][0] == 15 and fp() == menus0 and ofp() == order0)
check('복구한 가게를 다시 적용하면 정상(구버전 응답 호환: 복구 직후 get_store.photos는 빈 배열)', anon('select public.get_store(%s::uuid)', (sid,))['photos'] == [] and run('--apply', '--yes-dev-project', '--stores', key) == 0
      and q("select count(*) from public.store_photos where store_id=%s", (sid,))[0][0] == len(M[6]['photos']))
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True)
sys.exit(0 if all(results) else 1)
