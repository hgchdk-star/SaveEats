# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해
점검·거절 경로·적용·Guest 응답·재실행·복구·삭제/숨김 분기를 시험한다. 실서버에는 연결하지 않는다.
실행: DOMINO_PACKAGE=<수집 폴더> python tests/test_domino_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('DOMINO_PACKAGE')
if not PKG:
    sys.exit('DOMINO_PACKAGE(수집 자료 폴더)가 필요합니다')
TOOL = TOOLDIR + '/import_domino.py'
SID = '9d5acc03-45c5-581b-a657-22ee8773b28c'
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
# 실서버와 같은 참조: 포테이토 (M) 주문 항목 4개 + 리뷰 1개, 슈퍼디럭스 (M) 주문 항목 1개
USER = str(uuid.uuid4()); ORD = str(uuid.uuid4())
q("insert into auth.users (id) values (%s)", (USER,))
q("""insert into public.orders (id, user_id, store_id, idempotency_key, request_fingerprint, total_amount, store_name_snapshot, category_code_snapshot, category_name_snapshot,
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),20500,'도미노피자','pizza','피자',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
line = 0
def add_item(menu_id, name, price):
    global line
    line += 1
    q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,%s,%s,%s,0,%s,1,%s)",
      (str(uuid.uuid4()), ORD, SID, menu_id, line, name, price, price, price), replica=True)
for _ in range(4): add_item('14db58a7-7c06-54ce-ad95-3b4551000ab1', '포테이토 (M)', 20500)
add_item('52adc2b0-0030-528e-a79a-eb2496af0f02', '슈퍼디럭스 (M)', 21500)
q("insert into public.review_menus (review_id, menu_id) values (%s,'14db58a7-7c06-54ce-ad95-3b4551000ab1')", (str(uuid.uuid4()),), replica=True)

BK = tempfile.mkdtemp(prefix='domino-test-backup-')
env = dict(os.environ, DATABASE_URL=URI, DOMINO_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')
FLAGS = ('--option-max-quantity', '10', '--sold-out-mode', 'ignore', '--group-names', 'proposed')

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

# 1) 점검: 미결정 목록, 삭제·숨김 분기
rc, out = run('--check', flags=())
check('--check: 미결정 3개(수량 상한·품절·표시명)와 삭제 3·숨김 2', rc == 0 and out.count('(--') >= 2 and '앱 허용 상한' in out and '삭제 3개, 숨김 보존 2개' in out, out[-900:])
check('점검만으로 DB 변화 없음', q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5)
for missing, label in ((('--sold-out-mode', 'ignore', '--group-names', 'proposed'), '수량 상한'),
                       (('--option-max-quantity', '10', '--group-names', 'proposed'), '품절 반영'),
                       (('--option-max-quantity', '10', '--sold-out-mode', 'ignore'), '그룹 표시명')):
    rc, out = run('--apply', '--yes-dev-project', flags=missing)
    check(f'{label} 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) from public.menus where store_id=%s", (SID,))[0][0] == 5, out[-200:])

# 2) 적용
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-600:])
SELF = "from public.menus where store_id=%s"
check('활성 메뉴 265개, 숨김 보존 2개(포테이토 (M)·슈퍼디럭스 (M)), 삭제 3개', q("select count(*) filter (where is_active), count(*) filter (where not is_active) " + SELF, (SID,))[0] == (265, 2)
      and q("select count(*) from public.menus where id in ('3115a3ef-d067-581c-abe7-c79062276f10','9b001e30-d66d-5df0-ad6f-63f49cc26777','29298716-db5b-525a-aafb-1c21628ec532')")[0][0] == 0)
check('숨김 메뉴의 주문·리뷰 참조 그대로', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 5 and q("select count(*) from public.review_menus")[0][0] == 1)
check('옵션 그룹 732 + 숨김 메뉴의 기존 4, 옵션 5860 + 8', q("select count(*) from public.menu_option_groups")[0][0] == 736 and q("select count(*) from public.menu_options")[0][0] == 5868)
check('수량 조절 5796개: 1000→10(3892), 2→2(1904)', q("select count(*) filter (where allow_quantity and max_quantity=10), count(*) filter (where allow_quantity and max_quantity=2), count(*) filter (where max_quantity>10) from public.menu_options")[0] == (3892, 1904, 0))
check('음료 "최대 2개" 그룹 238개만 수량 합계 2, 종류 수(max_select)는 원본 2 그대로, 나머지 그룹은 합계 제한 없음', q("select count(*) filter (where max_total_quantity = 2), count(*) filter (where max_total_quantity is not null), count(*) filter (where name like '음료 (최대 2개%%' and max_select = 2) from public.menu_option_groups where menu_id in (select id from public.menus where store_id=%s and is_active)", (SID,))[0] == (238, 238, 238))
check('내부 기록에 원본 값과 SaveEats 제품 결정이 따로 있다', q("select count(*) from private.store_source_records where load_batch like 'domino%%' and subject_label like '옵션 그룹 수량 합계 제한%%' and note like '%%원본 값%%' and note like '%%제품 결정%%' and note like '%%확인한 사실이 아니다%%'")[0][0] == 1)
check('품절 기록은 원본 상태·수집 시점과 앱 표시 결정을 구분', q("select count(*) from private.store_source_records where load_batch like 'domino%%' and collected_for = 'MENU_PRICE' and note like '%%SOLD_OUT_TODAY%%(수집 시점 2026-11-19)%%앱 표시 결정%%확인된 사실이 아님%%'")[0][0] == 39,
      q("select left(note, 200) from private.store_source_records where load_batch like 'domino%%' and note like '%%SOLD_OUT_TODAY%%' limit 1"))
check('메뉴 그룹 8개·소속 265', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 8 and q("select count(*) from public.store_menu_group_items where store_id=%s", (SID,))[0][0] == 265)
check('원본 그룹명은 source_name에 보존, 표시명은 셰프컬렉션', q("select name, source_name from public.store_menu_groups where sort_order=0")[0] == ('셰프컬렉션', '[와우전용] 이츠셰프컬렉션'))
check('다른 가게 불변', fp() == fp_other)
check('메뉴 이름(원본 약어 포함)이 그대로', q("select count(*) from public.menus where store_id=%s and name = '[오하] 와일드 와일드 웨스트 스테이크 고구마쥬 엣지 (L)'", (SID,))[0][0] == 1)
check('수집 당시 품절 39개도 판매 가능(ignore 모드)', q("select count(*) from public.menus where store_id=%s and is_sold_out", (SID,))[0][0] == 0)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
check('Guest get_store: 그룹 8개 이름·순서', [g['name'] for g in d['menuGroups']] == ['셰프컬렉션', '프리미엄', '하프앤하프', '클래식', '더블치즈엣지', '사이드디시', '음료', '기타'], [g['name'] for g in d['menuGroups']])
check('Guest get_store: 활성 메뉴 265개, menus 순서 = 그룹 순서, 숨김 메뉴 없음', len(d['menus']) == 265 and [m['id'] for m in d['menus']] == [i for g in d['menuGroups'] for i in g['menuIds']])
check('첫 메뉴는 원본 첫 메뉴', d['menus'][0]['name'] == '[오] 이준 셰프의 레몬 버터 더블 살시챠 (L)')
idm = json.load(open(TOOLDIR + '/id_map.json'))
if os.environ.get('DOMINO_DUMP'):  # 앱 코드 시험용: Guest get_menu 응답 전체를 저장
    json.dump([anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']], open(os.environ['DOMINO_DUMP'], 'w'), ensure_ascii=False)
m = anon('select public.get_menu(%s::uuid)', (idm['menus']['125500791'],))
check('메뉴 상세: 필수 그룹 없음(바로 담기 가능), 사이드·기타·음료 그룹이 이 메뉴 소유로만 보인다', all(g['minSelect'] == 0 for g in m['optionGroups']) and m['price'] == 35400 and len({g['id'] for g in m['optionGroups']}) == len(m['optionGroups']), [(g['name'], g['maxSelect']) for g in m['optionGroups']])
mm = anon('select public.get_menu(%s::uuid)', (idm['menus']['125500792'],))
check('다른 메뉴의 같은 원본 그룹은 별도 UUID(공유 없음)', not ({g['id'] for g in m['optionGroups']} & {g['id'] for g in mm['optionGroups']}) and not ({o['id'] for g in m['optionGroups'] for o in g['options']} & {o['id'] for g in mm['optionGroups'] for o in g['options']}))
d2 = [g for g in m['optionGroups'] if g['name'].startswith('음료 (최대 2')]
check('Guest 상세: 음료 그룹 maxTotalQuantity=2, 사이드·기타는 null', all(g['maxTotalQuantity'] == 2 for g in d2) and all(g['maxTotalQuantity'] is None for g in m['optionGroups'] if not g['name'].startswith('음료 (최대 2')), [(g['name'], g['maxTotalQuantity']) for g in m['optionGroups']])
qd = [(g['name'].strip(), o['maxQuantity']) for g in m['optionGroups'] for o in g['options'] if o.get('maxQuantity')]
check('상세: 사이드·기타 수량 상한 10, 음료(최대 2개) 2', {x for x in qd if x[0] in ('사이드', '기타')} <= {('사이드', 10), ('기타', 10)} and {x for x in qd if x[0].startswith('음료')} <= {('음료 (최대 2개 가능)', 2)}, qd[:6])
check('숨김 메뉴의 기존 가상 옵션은 앱에 노출되지 않는다', q("select count(*) from public.menus where id='14db58a7-7c06-54ce-ad95-3b4551000ab1' and is_active")[0][0] == 0)

# 4) 재실행 중복 없음, 검증
before = cnt()
rc, out = run('--apply', '--yes-dev-project')
check('재실행 성공·중복 없음', rc == 0 and cnt() == before, (rc, cnt(), before, out[-300:]))
rc, out = run('--verify')
check('--verify 통과', rc == 0 and 'FAIL' not in out, out[-400:])

# 5) 복구
bks = sorted(d for d in os.listdir(BK) if d not in pre_dirs)
first = os.path.join(BK, bks[0])
bkj = json.load(open(first + '/backup.json'))
check('첫 적용 전 백업은 복구 기준, 재실행 백업은 기준 아님', bkj['applied_before_backup'] == [] and json.load(open(os.path.join(BK, bks[-1]) + '/backup.json'))['applied_before_backup'] != [])
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt and 'sb_secret' not in bt)
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', os.path.join(BK, bks[-1]))
check('재실행 시점 백업으로는 복구 거절', rc != 0 and '복구 기준이 아닙니다' in out, out[-200:])
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', first)
check('복구 성공', rc == 0 and 'FAIL' not in out, out[-600:])
check('복구 후: 원래 메뉴 5개(전부 활성)·옵션 그룹 10·옵션 20', q("select count(*) filter (where is_active) " + SELF, (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 10 and q("select count(*) from public.menu_options")[0][0] == 20)
check('복구 후: 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'domino%%'")[0][0] == 0 and fp() == fp_other)

# 6) 점검 이후 새 참조가 생기면 삭제 대신 숨김으로 분기
add_item('3115a3ef-d067-581c-abe7-c79062276f10', '리얼불고기 (M)', 22500)
rc, out = run('--check', flags=FLAGS)
check('점검 이후 새 주문이 가리킨 메뉴는 삭제 예정이 아니라 숨김 보존으로 바뀐다', rc == 0 and '삭제 2개, 숨김 보존 3개' in out, out[-300:])
rc, out = run('--apply', '--yes-dev-project')
check('그 상태로 적용 성공: 리얼불고기 (M) 숨김 보존', rc == 0 and q("select count(*) filter (where not is_active) from public.menus where store_id=%s", (SID,))[0][0] == 3, out[-300:])
bks2 = sorted(d for d in os.listdir(BK) if d not in pre_dirs and d not in bks)
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', os.path.join(BK, bks2[-1]))
check('복구 성공(숨김 분기 포함)', rc == 0 and 'FAIL' not in out, out[-400:])
# 7) 품절 source 모드·그룹명 원본(다른 모드 확인). 음료 합계 규칙은 그대로
rc, out = run('--apply', '--yes-dev-project', flags=('--option-max-quantity', '10', '--sold-out-mode', 'source', '--group-names', 'source'))
check('품절 source 모드: 수집 당시 품절 39개를 품절로 표시, 그룹명 원본 그대로, 음료 합계 제한 유지', rc == 0 and q("select count(*) from public.menus where store_id=%s and is_sold_out", (SID,))[0][0] == 39
      and q("select name from public.store_menu_groups where sort_order=0")[0][0] == '[와우전용] 이츠셰프컬렉션'
      and q("select count(*) from public.menu_option_groups where max_total_quantity = 2")[0][0] == 238, out[-400:])
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True)
sys.exit(0 if all(results) else 1)
