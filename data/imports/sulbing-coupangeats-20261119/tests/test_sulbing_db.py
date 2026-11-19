# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해
미결정 거절·적용·Guest 응답·'(기본제공)' 필수 그룹·복수 사진 대표 선택·재실행·복구를 시험한다. 실서버에는 연결하지 않는다.
실행: SULBING_PACKAGE=<수집 폴더> python tests/test_sulbing_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('SULBING_PACKAGE')
if not PKG:
    sys.exit('SULBING_PACKAGE(수집 자료 폴더)가 필요합니다')
SID = '3ddc0b28-61f6-5531-a1c8-1a9f8d08404a'
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
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),9900,'설빙','x','y',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
line = 0
for mid, n in snap['_order_items'].items():
    nm = next(m for m in snap['menus'] if m['id'] == mid)
    for _ in range(n):
        line += 1
        q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,%s,%s,%s,0,%s,1,%s)",
          (str(uuid.uuid4()), ORD, SID, mid, line, nm['name'], nm['base_price'], nm['base_price'], nm['base_price']), replica=True)
for mid, n in snap['_reviews'].items():
    for _ in range(n):
        q("insert into public.review_menus (review_id, menu_id) values (%s,%s)", (str(uuid.uuid4()), mid), replica=True)

BK = tempfile.mkdtemp(prefix='sulbing-test-backup-')
env = dict(os.environ, DATABASE_URL=URI, SULBING_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')
FLAGS = ('--included-groups', 'keep', '--photo-choice', 'proposed')
TOOL = os.path.join(TOOLDIR, 'import_sulbing.py')

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

# 0) 계획(사진 선택안): 복수 사진 9개 메뉴에 선택안 사진만 올리고 다른 파일은 올리지 않는다
sys.path.insert(0, TOOLDIR)
import import_sulbing as T
plan = T.build_plan(PKG, snap | {'snapshot_option_ids': [], 'snapshot_group_ids': [], 'menu_groups': [], 'menu_group_items': []}, photo_mode='proposed', included_mode='keep')
pol = json.load(open(TOOLDIR + '/option_policy.json', encoding='utf-8'))
by_sid = {m['source_menu_id']: m['id'] for m in plan['menus']}
sel = {by_sid[int(k)]: v['sha256'] for k, v in pol['photo_choice'].items()}
up = {p['menu_id']: p['sha256'] for p in plan['photos']}
check('복수 사진 9개 메뉴: 선택안 사진(아이스 컵)만 업로드 계획에 있다', len(sel) == 9 and all(up.get(mid) == sha for mid, sha in sel.items()), [(k, up.get(k)) for k in sel][:2])
check('사진 계획: 새 메뉴 97개 업로드·기존 5개 유지·미확보 0개', len(plan['photos']) == 97 and len(plan['kept_photos']) == 5 and not plan['missing_photo_menus'])
plan2 = T.build_plan(PKG, snap | {'snapshot_option_ids': [], 'snapshot_group_ids': [], 'menu_groups': [], 'menu_group_items': []}, photo_mode=None, included_mode=None)
check('결정 전에는 미결정으로 표시', len(plan2['undecided']) == 2, plan2['undecided'])

# 1) 점검·거절
rc, out = run('--check', flags=())
check('--check: 연결 5·새 메뉴 97·삭제 메뉴 0, 미결정 2개', rc == 0 and '기존 UUID 유지 갱신 5개 + 새로 추가 97개' in out and '--included-groups' in out and '--photo-choice' in out, out[-600:])
check('점검만으로 DB 변화 없음', q("select count(*) " + Y, (SID,))[0][0] == 5)
for drop, label in ((('--photo-choice', 'proposed'), '기본제공 그룹 처리'), (('--included-groups', 'keep'), '대표 사진')):
    rc, out = run('--apply', '--yes-dev-project', flags=drop)
    check(f'{label} 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) " + Y, (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) " + Y, (SID,))[0][0] == 5)

# 2) 적용(keep: 원본 그대로)
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-700:])
check('메뉴 102개 전부 활성(연결 5 + 새 97), 삭제·숨김 메뉴 없음', q("select count(*), count(*) filter (where is_active) " + Y, (SID,))[0] == (102, 102))
check('연결 5개: UUID·사진·인기 유지, 가격 +1,500 갱신, 설명 채움', q("select base_price, image_ref, is_popular, popularity_score, description is not null from public.menus where id='b4a1e906-23ef-53a9-ab94-0c7feea1ff7b'")[0] == (11400, 'menus/b4a1e906-23ef-53a9-ab94-0c7feea1ff7b.png', True, 10, True)
      and q("select base_price from public.menus where id='cf5bfca8-3816-52bf-ae6b-a562bf4f2a06'")[0][0] == 16000)
check('옵션 그룹 91·옵션 761(기존 가상 그룹 5·선택지 15 삭제), 비활성 그룹 없음', q("select count(*) from public.menu_option_groups")[0][0] == 91 and q("select count(*) from public.menu_options")[0][0] == 761 and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 0)
check('필수 그룹 53개(메뉴 43개), 수량 조절·단독·합계 제한 0개', q("select count(*), count(distinct menu_id) from public.menu_option_groups where min_select >= 1")[0] == (53, 43)
      and q("select count(*) filter (where allow_quantity), count(*) filter (where max_quantity is not null), count(*) filter (where is_exclusive) from public.menu_options")[0] == (0, 0, 0)
      and q("select count(*) from public.menu_option_groups where max_total_quantity is not null")[0][0] == 0)
check('메뉴 그룹 10개·소속 102개(중복 소속 없음), 토핑추가 그룹 34개 단품과 상세 추가토핑 옵션을 따로 보존', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 10 and q("select count(*), count(distinct menu_id) from public.store_menu_group_items where store_id=%s", (SID,))[0] == (102, 102)
      and q("select count(*) from public.store_menu_group_items i join public.store_menu_groups g on g.id=i.group_id where g.source_name='토핑추가'")[0][0] == 34 and q("select count(*) from public.menu_options where name like '%%(토핑)'")[0][0] > 600)
check('가게 영업 상태·추천 표시 유지(오픈 준비 중이라는 수집 화면 상태와 무관)', q("select is_open, is_active, is_recommended from public.stores where id=%s", (SID,))[0] == (True, True, True))
check('주문·리뷰 스냅샷 보존, 다른 가게 불변', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 2 and q("select count(*) from public.review_menus")[0][0] == 1 and fp() == fp_other)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
names = [(g['name'], len(g['menuIds'])) for g in d['menuGroups']]
check('Guest get_store: 그룹 10개 이름·순서·소속 수', names == [('추천메뉴', 2), ('설빙', 17), ('사이드', 14), ('간편식', 4), ('토핑추가', 34), ('커피', 9), ('음료', 7), ('차', 9), ('에이드', 4), ('기타', 2)], names)
check('Guest get_store: 메뉴 102개 중복 없음, 첫 메뉴는 원본 첫 메뉴(추천메뉴 그룹은 수집 그룹일 뿐 추천·인기 점수와 무관)', len(d['menus']) == 102 and len({m['id'] for m in d['menus']}) == 102 and d['menus'][0]['name'] == '허쉬초코크런치설빙'
      and q("select count(*) from public.menus where store_id=%s and is_popular", (SID,))[0][0] == 1)
idm = json.load(open(TOOLDIR + '/id_map.json'))
bing = anon('select public.get_menu(%s::uuid)', (idm['menus']['125004621'],))
check('허쉬초코크런치설빙: 필수 "연유 선택"((기본제공) 0원 하나, 자동 선택 없음) + 선택 추가토핑(최대 20종, 35개 선택지), 수량 필드 없음', [(g['name'].strip(), g['minSelect'], g['maxSelect'], len(g['options'])) for g in bing['optionGroups']] == [('연유 선택', 1, 1, 1), ('추가토핑 (최대 20개 가능)', 0, 20, 35)]
      and all(o.get('maxQuantity') is None and not o.get('isExclusive') for g in bing['optionGroups'] for o in g['options']) and all(g.get('maxTotalQuantity') is None for g in bing['optionGroups']), [(g['name'], g['minSelect'], len(g['options'])) for g in bing['optionGroups']])
if os.environ.get('SULBING_DUMP'):
    json.dump([anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']], open(os.environ['SULBING_DUMP'], 'w'), ensure_ascii=False)
    json.dump(d, open(os.environ['SULBING_DUMP'] + '.store.json', 'w'), ensure_ascii=False)

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
check('복구 후: 원래 메뉴 5개·가격·옵션 그룹 5·옵션 15, 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) filter (where is_active) " + Y, (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 5
      and q("select count(*) from public.menu_options")[0][0] == 15 and q("select base_price from public.menus where id='b4a1e906-23ef-53a9-ab94-0c7feea1ff7b'")[0][0] == 9900
      and q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'sulbing%%'")[0][0] == 0 and fp() == fp_other)

# 6) 다른 결정: 기본제공 필수 그룹 숨김(hidden)
rc, out = run('--apply', '--yes-dev-project', flags=('--included-groups', 'hidden', '--photo-choice', 'proposed'))
check('hidden 모드: 기본제공 필수 그룹 29개는 비활성(행 보존), 필수 그룹은 24개·메뉴 24개만 남고 앱 응답에 없다', rc == 0 and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 29
      and q("select count(*), count(distinct menu_id) from public.menu_option_groups where is_active and min_select >= 1")[0] == (24, 24)
      and not any(g['name'].strip() == '연유 선택' for g in anon('select public.get_menu(%s::uuid)', (idm['menus']['125004621'],))['optionGroups']), out[-500:])
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True)
sys.exit(0 if all(results) else 1)
