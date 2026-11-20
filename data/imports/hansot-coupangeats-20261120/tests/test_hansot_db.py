# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해
미결정 거절·적용·Guest 응답·수량 옵션·그룹 수량 합계·바로 담기·재실행·복구·스냅샷 참조 가상 옵션 분기를 시험한다. 실서버에는 연결하지 않는다.
실행: HANSOT_PACKAGE=<수집 폴더> python tests/test_hansot_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('HANSOT_PACKAGE')
if not PKG:
    sys.exit('HANSOT_PACKAGE(수집 자료 폴더)가 필요합니다')
SID = '5ab234b5-79cd-58a6-ab73-0b14376ad985'
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
q("insert into public.stores (id, category_id, name, image_ref, is_recommended, is_open) values (%s,%s,%s,%s,%s,%s)", (SID, st['category_id'], st['name'], st['image_ref'], st['is_recommended'], st['is_open']))
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
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),7600,'한솥도시락','x','y',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
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

BK = tempfile.mkdtemp(prefix='hansot-test-backup-')
TOOLPARENT = tempfile.mkdtemp(prefix='hansot-test-tool-')   # 승인 분기 시험용 도구 복사본(매핑 파일만 다르게)
TOOLCOPY = os.path.join(TOOLPARENT, 'hansot')
os.makedirs(TOOLCOPY); os.makedirs(os.path.join(TOOLPARENT, 'goobne-coupangeats-20261117'))
shutil.copy(os.path.join(TOOLDIR, '..', 'goobne-coupangeats-20261117', 'import_goobne.py'), os.path.join(TOOLPARENT, 'goobne-coupangeats-20261117', 'import_goobne.py'))
for f in ('import_hansot.py', 'menu_mapping.json', 'option_policy.json', 'menu_group_display.json'):
    shutil.copy(os.path.join(TOOLDIR, f), os.path.join(TOOLCOPY, f))
env = dict(os.environ, DATABASE_URL=URI, HANSOT_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')
FLAGS = ('--option-max-quantity', '10', '--group-total-mode', 'source-max', '--link-descriptions', 'source', '--photo-choice', 'proposed')

def run(*args, flags=FLAGS, tool=None):
    tool = tool or os.path.join(TOOLDIR, 'import_hansot.py')
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

GROUPS20 = [('신메뉴', 11), ('스페셜', 3), ('프리미엄', 2), ('세트', 2), ('고기고기', 3), ('마요', 5), ('모둠', 9), ('덮밥', 11), ('비빔밥', 3), ('볶음밥', 2), ('찌개', 2), ('실속반찬', 8),
            ('미니반찬', 2), ('치킨', 4), ('스낵', 8), ('프리즈드라이 국', 6), ('소스류', 5), ('음료류', 17), ('라면류', 7), ('밥', 1)]
M_MAYO, M_DONG, M_JE, M_GOGI, M_JEYUK = 'aa9b0e7a-ea6d-56fb-a53a-950f247b3a13', '63103290-798f-56f5-a3d7-1787c2d915ce', '6854fd60-0e8c-5461-ad4c-1818ecd3c76a', '439f46f9-a865-5b4f-a4e3-1c4394e3bfac', 'dba0e2be-77d9-5b95-a8c3-45647cd492a8'
REF_G = '7a5dfeb7-0b9a-54c9-a155-97cef806cf9d'

# 0) 계획: 사진 선택안
sys.path.insert(0, TOOLDIR)
import import_hansot as T
base = snap | {'menu_groups': [], 'menu_group_items': []}
plan = T.build_plan(PKG, base, photo_mode='proposed', option_max_quantity=10, total_mode='source-max', desc_mode='source')
pol = json.load(open(TOOLDIR + '/option_policy.json', encoding='utf-8'))
by_sid = {m['source_menu_id']: m['id'] for m in plan['menus']}
sel = {by_sid[int(k)]: v['sha256'] for k, v in pol['photo_choice'].items()}
up = {p['menu_id']: p['sha256'] for p in plan['photos']}
check('복수 사진 음료 7개: 선택안 사진만 업로드 계획에 있다', len(sel) == 7 and all(up.get(mid) == sha for mid, sha in sel.items()))
check('사진 계획: 111개 전부 업로드(새 메뉴 107 + 연결 4는 별도 경로로 교체)·미확보 0개·연결 4개의 새 경로는 기존 경로와 다르다', len(plan['photos']) == 111 and len(plan['replaced_photos']) == 4 and not plan['missing_photo_menus'] and all(r['new_object_path'] != r['existing_image_ref'] for r in plan['replaced_photos']))

# 1) 점검·거절
rc, out = run('--check', flags=())
check('--check: 연결 4·새 메뉴 107·삭제 1, 미결정 안내', rc == 0 and '기존 UUID 유지 갱신 4개 + 새로 추가 107개' in out and '--group-total-mode' in out and '--link-descriptions' in out and '--photo-choice' in out, out[-600:])
check('점검만으로 DB 변화 없음', q("select count(*) " + Y, (SID,))[0][0] == 5)
for drop, label in ((('--group-total-mode', 'source-max'), '그룹 수량 합계'), (('--link-descriptions', 'source'), '설명 처리'), (('--photo-choice', 'proposed'), '대표 사진'), (('--option-max-quantity', '10'), '옵션 수량 상한')):
    fl = list(FLAGS)
    i = fl.index(drop[0]); del fl[i:i + 2]
    rc, out = run('--apply', '--yes-dev-project', flags=tuple(fl))
    check(f'{label} 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) " + Y, (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) " + Y, (SID,))[0][0] == 5)

# 2) 적용(서정 승인된 매핑)
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-700:])
check('메뉴 111개 전부 활성(연결 4 + 새 107), 제육볶음도시락 삭제', q("select count(*), count(*) filter (where is_active) " + Y, (SID,))[0] == (111, 111)
      and q("select count(*) from public.menus where id=%s", (M_JEYUK,))[0][0] == 0)
check('연결 4개: UUID·인기 유지, 가격 갱신(5,100·6,400·6,700·8,500), 사진은 수집 사진의 새 경로로 교체', q("select base_price, is_popular, popularity_score from public.menus where id=%s", (M_MAYO,))[0] == (5100, True, 40)
      and [q("select base_price from public.menus where id=%s", (x,))[0][0] for x in (M_DONG, M_JE, M_GOGI)] == [6400, 6700, 8500]
      and all(q("select image_ref from public.menus where id=%s", (x,))[0][0].startswith('menus/' + x + '-') for x in (M_MAYO, M_DONG, M_JE, M_GOGI)))
check('사진 111개가 모두 자기 메뉴 UUID 경로로 연결(사진 없는 메뉴 0, 서로 다른 경로 111개)', q("select count(*), count(distinct image_ref), count(*) filter (where image_ref like 'menus/' || id::text || '%%') " + Y, (SID,))[0] == (111, 111, 111))
check('"(BEST)" 두 메뉴는 수집본 이름으로 맞춤, 과거 주문 스냅샷 이름은 그대로', q("select name from public.menus where id=%s", (M_DONG,))[0][0] == '(BEST)돈까스도련님'
      and q("select name from public.menus where id=%s", (M_GOGI,))[0][0] == '(BEST)돈까스도련님 고기고기' and q("select count(*) from public.order_items where menu_name_snapshot='돈까스도련님'")[0][0] == 1)
check('설명은 수집 설명으로 교체(source 모드)', q("select description from public.menus where id=%s", (M_MAYO,))[0][0] != next(m['description'] for m in snap['menus'] if m['id'] == M_MAYO))
check('승인된 매핑: 옵션 그룹 238·옵션 1308(가상 그룹 5·선택지 10 전부 삭제), 비활성 없음, 스냅샷 행은 그대로', q("select count(*) from public.menu_option_groups")[0][0] == 238 and q("select count(*) from public.menu_options")[0][0] == 1308
      and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 0 and q("select count(*) from public.order_item_options")[0][0] == 1)
check('적용 중 서버 검증: 계란후라이·김치·찌개 실제 그룹에서 한 선택지 10개·6+4 통과, 6+5·11개 거절', out.count('6개 + ') == 6 and out.count('서버 INVALID_OPTIONS') >= 6 and 'FAIL' not in out, [l for l in out.splitlines() if 'FAIL' in l][:3])
check('수량 조절 옵션 288개(상한 10), 그 외 옵션은 수량 필드 없음·단독 0', q("select count(*) filter (where allow_quantity), count(*) filter (where max_quantity is not null), max(max_quantity), count(*) filter (where is_exclusive) from public.menu_options")[0] == (288, 288, 10, 0))
check('수량형 그룹 144개(계란후라이·김치·찌개 각 48)는 수량 합계 상한 10, 밥추가 그룹 46개는 최대 1·합계 상한 없음, 필수 그룹 0개', q("select count(*) from public.menu_option_groups where max_total_quantity = 10")[0][0] == 144
      and q("select count(*) from public.menu_option_groups where max_total_quantity is not null")[0][0] == 144
      and q("select count(*) from public.menu_option_groups where name like '밥추가선택%%' and max_select = 1 and is_active")[0][0] == 46
      and q("select count(*) from public.menu_option_groups where min_select >= 1 and is_active")[0][0] == 0)
check('메뉴 그룹 20개·소속 111개(중복 소속 없음)', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 20 and q("select count(*), count(distinct menu_id) from public.store_menu_group_items where store_id=%s", (SID,))[0] == (111, 111))
check('가게 영업 상태·추천 표시 유지', q("select is_open, is_active, is_recommended from public.stores where id=%s", (SID,))[0] == (snap['store']['is_open'], True, snap['store']['is_recommended']))
check('주문·리뷰 스냅샷 보존, 다른 가게 불변', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 5 and q("select count(*) from public.order_item_options")[0][0] == 1 and q("select count(*) from public.review_menus")[0][0] == 1 and fp() == fp_other)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
names = [(g['name'], len(g['menuIds'])) for g in d['menuGroups']]
check('Guest get_store: 그룹 20개 이름·순서·소속 수', names == GROUPS20, names)
check('Guest get_store: 메뉴 111개 중복 없음, 첫 메뉴는 원본 첫 메뉴', len(d['menus']) == 111 and len({m['id'] for m in d['menus']}) == 111 and d['menus'][0]['name'] == '미니 찹쌀탕수육+칠리소스')
idm = json.load(open(TOOLDIR + '/id_map.json'))
details = [anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']]
check('111개 메뉴 모두 필수 옵션 그룹 없음(목록에서 바로 담기)', all(g['minSelect'] == 0 for dm in details for g in dm['optionGroups']))
qg = [g for dm in details for g in dm['optionGroups'] if g['maxTotalQuantity'] is not None]
check('Guest: 수량형 그룹 144개 maxTotalQuantity 10, 선택지는 allowQuantity·maxQuantity 10(원본 1000 아님)', len(qg) == 144 and all(g['maxTotalQuantity'] == 10 and all(o['allowQuantity'] and o['maxQuantity'] == 10 for o in g['options']) for g in qg))
check('Guest: 수량 필드 없는 옵션은 allowQuantity false·maxQuantity null(1000 없음)', all((not o['allowQuantity']) and o['maxQuantity'] is None for dm in details for g in dm['optionGroups'] if g['maxTotalQuantity'] is None for o in g['options']))
if os.environ.get('HANSOT_DUMP'):
    json.dump(details, open(os.environ['HANSOT_DUMP'], 'w'), ensure_ascii=False)
    json.dump(d, open(os.environ['HANSOT_DUMP'] + '.store.json', 'w'), ensure_ascii=False)

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
smap = json.load(open(first + '/snapshot_source_id_map.json'))
check('백업에 원본 ID ↔ 스냅샷 대응 기록(스냅샷 행 1건, 삭제 그룹 5)', len(smap['snapshot_rows_referencing_deleted']) == 1 and len(smap['deleted_groups']) == 5, list(smap))
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt and 'sb_secret' not in bt)
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', first)
check('복구 성공', rc == 0 and 'FAIL' not in out, out[-600:])
check('복구 후: 원래 메뉴 5개(제육볶음도시락 포함)·가격·이름·기존 사진 연결·옵션 그룹 5·옵션 10, 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) " + Y, (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 5
      and q("select count(*) from public.menu_options")[0][0] == 10 and q("select base_price, image_ref from public.menus where id=%s", (M_MAYO,))[0] == (3900, 'menus/' + M_MAYO + '.jpg') and q("select name from public.menus where id=%s", (M_DONG,))[0][0] == '돈까스도련님'
      and q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'hansot%%'")[0][0] == 0 and fp() == fp_other)

# 6) 승인 전 상태(복사본 매핑): 스냅샷 참조 가상 그룹은 삭제하지 않고 비활성 보존
mp = json.load(open(os.path.join(TOOLCOPY, 'menu_mapping.json'), encoding='utf-8'))
mp['approved_snapshot_referenced_group_ids'] = []
json.dump(mp, open(os.path.join(TOOLCOPY, 'menu_mapping.json'), 'w', encoding='utf-8'), ensure_ascii=False)
pre2 = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project', tool=os.path.join(TOOLCOPY, 'import_hansot.py'))
check('승인 전 매핑: 옵션 그룹 239(보류 1 = 치킨제육 밥 양)·옵션 1310, 비활성은 그 1개 그룹, 스냅샷 행은 그대로', rc == 0 and q("select count(*) from public.menu_option_groups")[0][0] == 239 and q("select count(*) from public.menu_options")[0][0] == 1310
      and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 1 and q("select id::text from public.menu_option_groups where not is_active")[0][0] == REF_G and q("select count(*) from public.order_item_options")[0][0] == 1, out[-500:])
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True); shutil.rmtree(TOOLPARENT, ignore_errors=True)
sys.exit(0 if all(results) else 1)
