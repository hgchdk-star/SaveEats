# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 스냅샷(tests/fixtures/existing_state.json)을 재현해
미결정 거절·적용·Guest 응답·숨김 메뉴·필수 옵션·재실행·복구·스냅샷 참조 가상 옵션 분기를 시험한다. 실서버에는 연결하지 않는다.
실행: BOBAE_PACKAGE=<수집 폴더> python tests/test_bobae_db.py   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
sys.path.insert(0, SCR)
import pgenv, psycopg2
PKG = os.environ.get('BOBAE_PACKAGE')
if not PKG:
    sys.exit('BOBAE_PACKAGE(수집 자료 폴더)가 필요합니다')
SID = 'ae4676a3-d07e-59c2-ac08-26dd7e8193fa'
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
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),14000,'보배반점','x','y',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
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

BK = tempfile.mkdtemp(prefix='bobae-test-backup-')
TOOLPARENT = tempfile.mkdtemp(prefix='bobae-test-tool-')   # 승인 분기 시험용 도구 복사본(매핑 파일만 다르게)
TOOLCOPY = os.path.join(TOOLPARENT, 'bobae')
os.makedirs(TOOLCOPY); os.makedirs(os.path.join(TOOLPARENT, 'goobne-coupangeats-20261117'))
shutil.copy(os.path.join(TOOLDIR, '..', 'goobne-coupangeats-20261117', 'import_goobne.py'), os.path.join(TOOLPARENT, 'goobne-coupangeats-20261117', 'import_goobne.py'))
for f in ('import_bobae.py', 'menu_mapping.json', 'option_policy.json', 'menu_group_display.json'):
    shutil.copy(os.path.join(TOOLDIR, f), os.path.join(TOOLCOPY, f))
env = dict(os.environ, DATABASE_URL=URI, BOBAE_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')
FLAGS = ('--hide-menus', 'hidden', '--link-descriptions', 'source')

def run(*args, flags=FLAGS, tool=None):
    tool = tool or os.path.join(TOOLDIR, 'import_bobae.py')
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
CM = '6c43a032-8e63-520d-a120-e18c556bad5c'

# 1) 점검·거절
rc, out = run('--check', flags=())
check('--check: 연결 4·새 메뉴 77·삭제 1, 숨김·설명 처리 미결정', rc == 0 and '기존 UUID 유지 갱신 4개 + 새로 추가 77개' in out and '--hide-menus' in out and '--link-descriptions' in out, out[-600:])
check('점검만으로 DB 변화 없음', q("select count(*) " + Y, (SID,))[0][0] == 5)
for drop, label in ((('--link-descriptions', 'source'), '숨김 노출'), (('--hide-menus', 'hidden'), '설명 처리')):
    rc, out = run('--apply', '--yes-dev-project', flags=drop)
    check(f'{label} 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) " + Y, (SID,))[0][0] == 5, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) " + Y, (SID,))[0][0] == 5)

# 2) 적용(승인 전: 스냅샷 참조 가상 그룹은 보류)
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out, out[-700:])
check('메뉴 81개(연결 4 + 새 77), 보배간짜장 삭제, 앱에 보이는 62개·숨김 19개', q("select count(*), count(*) filter (where is_active), count(*) filter (where not is_active) " + Y, (SID,))[0] == (81, 62, 19)
      and q("select count(*) from public.menus where id='538c494a-0187-5d7c-a626-c25970068023'")[0][0] == 0)
check('숨김 19개 = 리뷰이벤트 1 + 주류 18(그룹 소속 기준), 판매 상태는 품절 아님', q("select count(*) from public.menus where store_id=%s and not is_active and not is_sold_out and name = '포토 리뷰 이벤트 참여'", (SID,))[0][0] == 1
      and q("select count(*) from public.menus where store_id=%s and not is_active and base_price between 4000 and 35000 and id in (select menu_id from public.store_menu_group_items i join public.store_menu_groups g on g.id=i.group_id where g.source_name='주류')", (SID,))[0][0] == 18)
check('연결 4개: UUID·사진·인기 유지, 가격 갱신(소고기짬뽕 14,000·크림짬뽕 15,000), 보배짜장면은 수집본 이름(보배 짜장면)으로 맞춤, 과거 주문 스냅샷 이름은 그대로', q("select base_price, image_ref, is_popular, popularity_score from public.menus where id='58bb9517-8ec8-5100-a9f3-f55169348eb0'")[0] == (10500, 'menus/58bb9517-8ec8-5100-a9f3-f55169348eb0.png', True, 30)
      and q("select base_price from public.menus where id='791d911f-130e-551a-a95e-dbcca09e1f27'")[0][0] == 14000 and q("select base_price from public.menus where id=%s", (CM,))[0][0] == 15000
      and q("select name from public.menus where id='131d83bc-cc1c-5039-a2d0-ff120e30d0cb'")[0][0] == '보배 짜장면'
      and q("select count(*) from public.order_items where menu_name_snapshot='크림짬뽕'")[0][0] == 1)
check('연결 메뉴 설명은 수집 설명으로 교체(source 모드)', q("select description from public.menus where id='58bb9517-8ec8-5100-a9f3-f55169348eb0'")[0][0].startswith('진한 보배짬뽕 육수'))
check('승인된 매핑: 옵션 그룹 64·옵션 240(가상 그룹 7·선택지 16 삭제, 크림짬뽕 양 선택 포함), 보류 없음, 스냅샷 행은 그대로', q("select count(*) from public.menu_option_groups")[0][0] == 64 and q("select count(*) from public.menu_options")[0][0] == 240
      and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 0 and q("select count(*) from public.order_item_options")[0][0] == 1)
check('수량 조절·단독·합계 제한 0개, 필수 그룹 63개(메뉴 44개)', q("select count(*) filter (where allow_quantity), count(*) filter (where max_quantity is not null), count(*) filter (where is_exclusive) from public.menu_options")[0] == (0, 0, 0)
      and q("select count(*) from public.menu_option_groups where max_total_quantity is not null")[0][0] == 0
      and q("select count(*), count(distinct menu_id) from public.menu_option_groups where is_active and min_select >= 1 and menu_id in (select id from public.menus where store_id=%s)", (SID,))[0] == (63, 44))
check('메뉴 그룹 10개·소속 81개(중복 소속 없음, 숨김 메뉴 소속은 보존)', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == 10 and q("select count(*), count(distinct menu_id) from public.store_menu_group_items where store_id=%s", (SID,))[0] == (81, 81))
check('가게 영업 상태·추천 표시 유지(오픈 준비 중이라는 수집 화면 상태와 무관)', q("select is_open, is_active, is_recommended from public.stores where id=%s", (SID,))[0] == (True, True, True))
check('주문·리뷰 스냅샷 보존, 다른 가게 불변', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == 1 and q("select count(*) from public.order_item_options")[0][0] == 1 and q("select count(*) from public.review_menus")[0][0] == 1 and fp() == fp_other)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
names = [(g['name'], len(g['menuIds'])) for g in d['menuGroups']]
check('Guest get_store: 그룹 8개(숨긴 메뉴만 있는 리뷰이벤트·주류 그룹은 응답에서 빠짐), 이름·순서·소속 수', names == [('1인 세트메뉴', 4), ('2인 세트메뉴', 7), ('안주세트', 5), ('식사류(면)', 12), ('식사류(밥)', 9), ('요리류', 11), ('사이드', 8), ('음료', 6)], names)
check('Guest get_store: 보이는 메뉴 62개, 숨김 19개가 없다', len(d['menus']) == 62 and not any(m['name'] in ('포토 리뷰 이벤트 참여', '참이슬 후레쉬 360ml', '카스') for m in d['menus']) and d['menus'][0]['name'] == '짜장+탕수육(미니)')
idm = json.load(open(TOOLDIR + '/id_map.json'))
sw = anon('select public.get_menu(%s::uuid)', (idm['menus']['113003367'],))
check('1인 세트: 필수 그룹 2개(짜장 선택·탕수육 변경) 자동 선택 없음, 추가금·수량 필드 없음', [(g['name'].strip(), g['minSelect'], g['maxSelect']) for g in sw['optionGroups']] == [('짜장 선택', 1, 1), ('탕수육 변경', 1, 1)]
      and all(o.get('maxQuantity') is None and not o.get('isExclusive') for g in sw['optionGroups'] for o in g['options']), [(g['name'], g['minSelect']) for g in sw['optionGroups']])
if os.environ.get('BOBAE_DUMP'):
    json.dump([anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']], open(os.environ['BOBAE_DUMP'], 'w'), ensure_ascii=False)
    json.dump(d, open(os.environ['BOBAE_DUMP'] + '.store.json', 'w'), ensure_ascii=False)

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
check('백업에 원본 ID ↔ 스냅샷 대응 기록(스냅샷 행 1건, 삭제 그룹 7)', len(smap['snapshot_rows_referencing_deleted']) == 1 and len(smap['deleted_groups']) == 7, list(smap))
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt and 'sb_secret' not in bt)
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', first)
check('복구 성공', rc == 0 and 'FAIL' not in out, out[-600:])
check('복구 후: 원래 메뉴 5개(전부 활성)·옵션 그룹 7·옵션 16·설명 원래대로, 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) filter (where is_active) " + Y, (SID,))[0][0] == 5 and q("select count(*) from public.menu_option_groups")[0][0] == 7
      and q("select count(*) from public.menu_options")[0][0] == 16 and q("select description from public.menus where id='58bb9517-8ec8-5100-a9f3-f55169348eb0'")[0][0] == '고기와 해물을 넣은 얼큰한 짬뽕.'
      and q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like 'bobae%%'")[0][0] == 0 and fp() == fp_other)

# 6) 설명 keep + 서정 승인 뒤 스냅샷 참조 가상 그룹도 삭제
mp = json.load(open(os.path.join(TOOLCOPY, 'menu_mapping.json'), encoding='utf-8'))
mp['approved_snapshot_referenced_group_ids'] = []   # 승인 전 상태: 스냅샷 참조 가상 그룹은 삭제하지 않고 비활성으로 보존
json.dump(mp, open(os.path.join(TOOLCOPY, 'menu_mapping.json'), 'w', encoding='utf-8'), ensure_ascii=False)
pre2 = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project', flags=('--hide-menus', 'import', '--link-descriptions', 'keep'), tool=os.path.join(TOOLCOPY, 'import_bobae.py'))
check('승인 전 매핑 + import·keep 모드: 숨김 없이 81개 노출, 설명 유지, 스냅샷 참조 가상 그룹 1·선택지 2는 비활성 보존(옵션 그룹 65·옵션 242), 스냅샷 행은 그대로', rc == 0 and q("select count(*) filter (where is_active), count(*) " + Y, (SID,))[0] == (81, 81)
      and q("select description from public.menus where id='58bb9517-8ec8-5100-a9f3-f55169348eb0'")[0][0] == '고기와 해물을 넣은 얼큰한 짬뽕.' and q("select count(*) from public.menu_option_groups")[0][0] == 65 and q("select count(*) from public.menu_options")[0][0] == 242
      and q("select count(*) from public.order_item_options")[0][0] == 1 and q("select count(*) from public.menu_option_groups where not is_active")[0][0] == 1, out[-500:])
check('출력에 접속 문자열 없음', URI not in out)
print(f'{sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True); shutil.rmtree(TOOLPARENT, ignore_errors=True)
sys.exit(0 if all(results) else 1)
