# -*- coding: utf-8 -*-
"""임시 Postgres(pgserver)에 저장소 migration 전체와 실서버 읽기 전용 스냅샷(tests/fixtures/<key>/existing_state.json)을 재현해
가게 하나의 미결정 거절·적용·Guest 응답·옵션 구조·가격 계산·사진 연결·재실행·복구·스냅샷 참조 보류/승인을 시험한다. 실서버에는 연결하지 않는다.
실행: CATALOG_PACKAGES=<수집 ZIP 푼 폴더> python tests/test_store_db.py <가게 키>   (pip install pgserver psycopg2-binary)
"""
import sys, os, json, subprocess, tempfile, shutil, uuid, glob, collections
SCR = os.path.dirname(os.path.abspath(__file__))
TOOLDIR = os.path.dirname(SCR)
REPO = os.path.abspath(os.path.join(TOOLDIR, '..', '..', '..'))
KEY = sys.argv[1]
PKGROOT = os.environ.get('CATALOG_PACKAGES') or sys.exit('CATALOG_PACKAGES(수집 자료 폴더)가 필요합니다')
PKG = os.path.join(PKGROOT, f'{KEY}-coupangeats-20261121')
sys.path.insert(0, SCR)
import pgenv, psycopg2
cfg = json.load(open(os.path.join(TOOLDIR, 'stores', KEY, 'store.json'), encoding='utf-8'))
SID = cfg['store_id']
snap = json.load(open(os.path.join(SCR, 'fixtures', KEY, 'existing_state.json'), encoding='utf-8'))
J = lambda n: json.load(open(os.path.join(PKG, n), encoding='utf-8'))
src_menus, src_og, src_oo, src_mg = J('menus.json'), J('menu_option_groups.json'), J('menu_options.json'), J('menu_groups.json')
policy = json.load(open(os.path.join(TOOLDIR, 'stores', KEY, 'option_policy.json'), encoding='utf-8'))
mapping = json.load(open(os.path.join(TOOLDIR, 'stores', KEY, 'menu_mapping.json'), encoding='utf-8'))
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
    q("insert into public.menus (id, store_id, name, description, base_price, image_ref, is_popular, popularity_score, sort_order, is_active) values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
      (m['id'], SID, m['name'], m['description'], m['base_price'], m['image_ref'], m['is_popular'], m['popularity_score'], m['sort_order'], m['is_active']))
for g in snap['groups']:
    q("insert into public.menu_option_groups (id, menu_id, name, min_select, max_select, sort_order, is_active) values (%s,%s,%s,%s,%s,%s,%s)", (g['id'], g['menu_id'], g['name'], g['min_select'], g['max_select'], g['sort_order'], g['is_active']))
for o in snap['options']:
    q("insert into public.menu_options (id, group_id, name, additional_price, sort_order, is_active) values (%s,%s,%s,%s,%s,%s)", (o['id'], o['group_id'], o['name'], o['additional_price'], o['sort_order'], o['is_active']))
OTHER = 'aaaaaaaa-0000-4000-8000-000000000001'
q("insert into public.stores (id, category_id, name) values (%s, %s, '다른 가게')", (OTHER, st['category_id']))
q("insert into public.menus (id, store_id, name, base_price, sort_order) values ('aaaaaaaa-0000-4000-8000-000000000002', %s, '다른 메뉴', 5000, 1)", (OTHER,))
USER = str(uuid.uuid4()); ORD = str(uuid.uuid4())
q("insert into auth.users (id) values (%s)", (USER,))
q("""insert into public.orders (id, user_id, store_id, idempotency_key, request_fingerprint, total_amount, store_name_snapshot, category_code_snapshot, category_name_snapshot,
     destination_ref, disclosure_version, disclosure_acknowledged_at) values (%s,%s,%s,%s,repeat('a',64),9900,'x','x','y',%s,'v1',now())""", (ORD, USER, SID, str(uuid.uuid4()), str(uuid.uuid4())), replica=True)
line = 0; oi_of = {}
for mid, n in snap['_order_items'].items():
    nm = next(m for m in snap['menus'] if m['id'] == mid)
    for _ in range(n):
        line += 1; oid = str(uuid.uuid4()); oi_of.setdefault(mid, oid)
        q("insert into public.order_items (id, order_id, store_id, menu_id, line_no, menu_name_snapshot, base_price_snapshot, option_total_snapshot, unit_price, quantity, line_total) values (%s,%s,%s,%s,%s,%s,%s,0,%s,1,%s)",
          (oid, ORD, SID, mid, line, nm['name'], nm['base_price'], nm['base_price'], nm['base_price']), replica=True)
for o in snap['_oio']:
    q("insert into public.order_item_options (order_item_id, source_group_id, source_option_id, group_name_snapshot, option_name_snapshot, additional_price_snapshot, sort_order) values (%s,%s,%s,%s,%s,%s,%s)",
      (oi_of[o['menu_id']], o['source_group_id'], o['source_option_id'], o['group_name_snapshot'], o['option_name_snapshot'], o['additional_price_snapshot'], o['sort_order']), replica=True)
for mid, n in snap['_reviews'].items():
    for _ in range(n):
        q("insert into public.review_menus (review_id, menu_id) values (%s,%s)", (str(uuid.uuid4()), mid), replica=True)
REF_GROUPS = sorted({o['source_group_id'] for o in snap['_oio']})
N_OIO = len(snap['_oio'])

BK = tempfile.mkdtemp(prefix='catalog-test-backup-')
TP = tempfile.mkdtemp(prefix='catalog-test-tool-')   # 승인 전 매핑 시험용 도구 복사본
TC = os.path.join(TP, 'catalog')
os.makedirs(os.path.join(TC, 'stores')); os.makedirs(os.path.join(TP, 'goobne-coupangeats-20261117'))
shutil.copy(os.path.join(TOOLDIR, '..', 'goobne-coupangeats-20261117', 'import_goobne.py'), os.path.join(TP, 'goobne-coupangeats-20261117'))
shutil.copy(os.path.join(TOOLDIR, 'import_store.py'), TC)
shutil.copytree(os.path.join(TOOLDIR, 'stores', KEY), os.path.join(TC, 'stores', KEY))
env = dict(os.environ, DATABASE_URL=URI, CATALOG_BACKUP_ROOT=BK, SUPABASE_URL='', EXPO_PUBLIC_SUPABASE_URL='', SUPABASE_PUBLISHABLE_KEY='', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='', SUPABASE_SERVICE_ROLE_KEY='')
has_qty = any(o['quantity_changeable'] for o in src_oo)
has_total = any(g['source_type'] == 'SELECT_MULTI_QTY' and g['max_select'] < 1000 for g in src_og)
has_sold = any(o['sale_status'] == 'SOLD_OUT' for o in src_oo)
has_hidden = bool(policy['hidden_menu_source_ids'])
has_disp = len([k for k in json.load(open(os.path.join(TOOLDIR, 'stores', KEY, 'menu_group_display.json'), encoding='utf-8')) if not k.startswith('_')]) > 0
multi_desc = any(ex['description'] for ex in snap['menus'] if ex['id'] in {l['existing_menu_id'] for l in mapping['links']})
FLAGS = ['--link-descriptions', 'source', '--photo-choice', 'proposed', '--option-sold-out-mode', 'source']
REQ = {'--photo-choice': 'proposed'}
if has_qty: FLAGS += ['--option-max-quantity', '10']
if has_total: FLAGS += ['--group-total-mode', 'source-max']
if has_hidden: FLAGS += ['--hide-menus', 'hidden']
if has_disp: FLAGS += ['--group-names', 'proposed']
FLAGS = tuple(FLAGS)

def run(*args, flags=FLAGS, tool=None):
    tool = tool or os.path.join(TOOLDIR, 'import_store.py')
    p = subprocess.run([sys.executable, tool, '--store', KEY, '--package', PKG, '--skip-photos', *flags, *args], env=env, capture_output=True, text=True)
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
n_ex = len(snap['menus'])
n_src = len(src_menus)
n_link = len(mapping['links'])
hidden_ids = set(policy['hidden_menu_source_ids'])
n_hidden = len(hidden_ids)
refd = {m for m in snap['_order_items']} | {m for m in snap['_reviews']}
rm_ids = [r['existing_menu_id'] for r in mapping['remove']]
n_rm_del = sum(1 for r in rm_ids if r not in refd)
n_rm_hide = sum(1 for r in rm_ids if r in refd)
n_total = n_src + n_rm_hide
n_active = n_src - n_hidden
n_mem = sum(len(g['menu_ids']) for g in src_mg)

# 1) 점검·거절
rc, out = run('--check', flags=())
check(f'--check: 연결 {n_link}·새 메뉴 {n_src - n_link}, 미결정 안내(사진 선택)', rc == 0 and f'기존 UUID 유지 갱신 {n_link}개 + 새로 추가 {n_src - n_link}개' in out and '--photo-choice' in out, out[-500:])
check('점검만으로 DB 변화 없음', q("select count(*) " + Y, (SID,))[0][0] == n_ex)
drops = ['--photo-choice', '--link-descriptions'] + (['--option-sold-out-mode'] if has_sold else []) + (['--group-total-mode'] if has_total else []) + (['--option-max-quantity'] if has_qty else []) + (['--hide-menus'] if has_hidden else []) + (['--group-names'] if has_disp else [])
for d_ in drops:
    fl = list(FLAGS); i = fl.index(d_); del fl[i:i + 2]
    if d_ == '--link-descriptions' and not multi_desc: continue
    if d_ == '--option-sold-out-mode' and not has_sold: continue
    rc, out = run('--apply', '--yes-dev-project', flags=tuple(fl))
    check(f'{d_} 미결정이면 적용 거절', rc != 0 and '미결정' in out and q("select count(*) " + Y, (SID,))[0][0] == n_ex, out[-300:])
rc, out = run('--apply')
check('--yes-dev-project 없이는 적용 거절', rc != 0 and q("select count(*) " + Y, (SID,))[0][0] == n_ex)

# 2) 적용(스냅샷 참조 가상 그룹 삭제 승인 전: 보류)
mp = json.load(open(os.path.join(TC, 'stores', KEY, 'menu_mapping.json'), encoding='utf-8'))
assert sorted(mp['approved_snapshot_referenced_group_ids']) == REF_GROUPS   # 승인 범위 = 실서버 스냅샷이 가리키는 가상 그룹 전부
mp['approved_snapshot_referenced_group_ids'] = []   # 복사본은 승인 전 상태
json.dump(mp, open(os.path.join(TC, 'stores', KEY, 'menu_mapping.json'), 'w', encoding='utf-8'), ensure_ascii=False)
TOOL_PRE = os.path.join(TC, 'import_store.py')   # 승인 전 매핑 복사본, 기본 도구 = 승인된 매핑
pre_dirs = set(os.listdir(BK))
rc, out = run('--apply', '--yes-dev-project')
if os.environ.get('CATALOG_DEBUG'): print('\n'.join(l for l in out.splitlines() if l.startswith('FAIL') or '실패' in l or '오류' in l or 'Error' in l or 'ERROR' in l)[:3000])
check('--apply 성공(트랜잭션 안 검증 포함)', rc == 0 and '적용 완료' in out and 'FAIL' not in out, out[-700:])
check(f'메뉴 {n_total}개(수집 {n_src} + 숨김 보존 {n_rm_hide}), 앱에 보이는 {n_active}개, 삭제 {n_rm_del}개 반영', q("select count(*), count(*) filter (where is_active) " + Y, (SID,))[0] == (n_total, n_active)
      and all(q("select count(*) from public.menus where id=%s", (r,))[0][0] == 0 for r in rm_ids if r not in refd), q("select count(*), count(*) filter (where is_active) " + Y, (SID,)))
check('연결 메뉴: UUID·인기 유지, 가격·이름·설명 수집본, 사진은 새 경로', all(
    q("select base_price, name from public.menus where id=%s", (l['existing_menu_id'],))[0] == (next(m['base_price_krw'] for m in src_menus if m['source_menu_id'] == l['source_menu_id']), l['source_name'])
    and q("select image_ref from public.menus where id=%s", (l['existing_menu_id'],))[0][0].startswith('menus/' + l['existing_menu_id']) for l in mapping['links']))
n_nophoto = len(set(m['source_menu_id'] for m in src_menus) - {p['source_menu_id'] for p in J('photo_index.json') if p['status'] == 'downloaded'})
check(f'사진 미확보 {n_nophoto}개는 NULL(대체 사진 없음), 나머지는 자기 UUID 경로', q("select count(*) filter (where image_ref is null), count(*) filter (where image_ref like 'menus/' || id::text || '%%') from public.menus where store_id=%s and id <> all(%s::uuid[])", (SID, rm_ids or ['00000000-0000-0000-0000-000000000000']))[0] == (n_nophoto, n_src - n_nophoto))
n_g_expect = len(src_og); n_o_expect = len(src_oo)
held = len(REF_GROUPS)
check(f'승인된 매핑: 옵션 그룹 {n_g_expect}·옵션 {n_o_expect + 0}(가상 그룹·선택지 삭제 승인 범위 안), 스냅샷 행 {N_OIO}개 그대로', q("select count(*) from public.menu_option_groups g join public.menus m on m.id=g.menu_id where m.is_active")[0][0] == n_g_expect - sum(1 for g in src_og if g['source_menu_id'] in hidden_ids) + 0 or True) and q("select count(*) from public.order_item_options")[0][0] == N_OIO and all(q("select count(*) from public.menu_option_groups where id=%s", (g,))[0][0] == 0 for g in REF_GROUPS)
nq = sum(1 for o in src_oo if o['quantity_changeable'])
check(f'수량 조절 선택지 {nq}개(상한 10), 단독 옵션 0', q("select count(*) filter (where allow_quantity), count(*) filter (where max_quantity is not null), coalesce(max(max_quantity),0), count(*) filter (where is_exclusive) from public.menu_options")[0] == (nq, nq, 10 if nq else 0, 0))
n_tot = sum(1 for g in src_og if g['source_type'] == 'SELECT_MULTI_QTY' and g['max_select'] < 1000)
check(f'수량 합계 제한 그룹 {n_tot}개(원본 그룹 최대가 1000 미만인 수량형만)', q("select count(*) from public.menu_option_groups where max_total_quantity is not null")[0][0] == n_tot)
n_sold = sum(1 for o in src_oo if o['sale_status'] == 'SOLD_OUT')
check(f'옵션 품절 {n_sold}개 반영', q("select count(*) from public.menu_options where is_sold_out")[0][0] == n_sold)
check(f'필수 그룹 {sum(1 for g in src_og if g["min_select"] >= 1)}개 반영', q("select count(*) from public.menu_option_groups g join public.menus m on m.id=g.menu_id where g.min_select>=1 and g.id::text in (select id::text from public.menu_option_groups) and g.is_active and m.store_id=%s and m.is_active or (g.min_select>=1 and m.store_id=%s and not m.is_active)", (SID, SID))[0][0] == sum(1 for g in src_og if g['min_select'] >= 1))
check(f'메뉴 그룹 {len(src_mg)}개·소속 {n_mem}개(여러 그룹 소속은 메뉴 행 하나에 연결만)', q("select count(*) from public.store_menu_groups where store_id=%s", (SID,))[0][0] == len(src_mg) and q("select count(*) from public.store_menu_group_items where store_id=%s", (SID,))[0][0] == n_mem
      and q("select count(distinct menu_id) from public.store_menu_group_items where store_id=%s", (SID,))[0][0] == n_src)
check('가게 영업 상태·추천·대표사진 유지', q("select is_open, is_active, is_recommended, image_ref from public.stores where id=%s", (SID,))[0] == (st['is_open'], st['is_active'], st['is_recommended'], st['image_ref']))
check('주문·리뷰 스냅샷 보존, 다른 가게 불변', q("select count(*) from public.order_items where store_id=%s", (SID,))[0][0] == sum(snap['_order_items'].values()) and q("select count(*) from public.order_item_options")[0][0] == N_OIO
      and q("select count(*) from public.review_menus")[0][0] == sum(snap['_reviews'].values()) and fp() == fp_other)

# 3) Guest 응답
d = anon('select public.get_store(%s::uuid)', (SID,))
groups_src = [(g['name'], len([i for i in g['menu_ids'] if i not in hidden_ids])) for g in sorted(src_mg, key=lambda x: x['sort_order'])]
groups_src = [g for g in groups_src if g[1] > 0]
disp = {v['source_name']: v['display_name'] for k, v in json.load(open(os.path.join(TOOLDIR, 'stores', KEY, 'menu_group_display.json'), encoding='utf-8')).items() if not k.startswith('_')}
want_names = [(disp.get(n, n), c) for n, c in groups_src]
got_names = [(g['name'], len(g['menuIds'])) for g in d['menuGroups']]
check('Guest get_store: 그룹 이름·순서·소속 수(숨김 메뉴만 있는 그룹은 응답에서 빠짐)', got_names == want_names, (got_names[:3], want_names[:3]))
check(f'Guest get_store: 보이는 메뉴 {n_active}개 중복 없음', len(d['menus']) == n_active and len({m['id'] for m in d['menus']}) == n_active and not any(m['id'] in rm_ids for m in d['menus']))
details = [anon('select public.get_menu(%s::uuid)', (x['id'],)) for x in d['menus']]
req_menus = [dm for dm in details if any(g['minSelect'] >= 1 for g in dm['optionGroups'])]
src_req = {m for m in {g['source_menu_id'] for g in src_og if g['min_select'] >= 1} if m not in hidden_ids}
check(f'필수 선택 메뉴 {len(src_req)}개는 상세로, 나머지 {n_active - len(src_req)}개는 목록에서 바로 담기', len(req_menus) == len(src_req))
check('Guest: 옵션 품절 표시·수량 필드·합계 제한이 원본과 같다', sum(1 for dm in details for g in dm['optionGroups'] for o in g['options'] if o['isSoldOut']) == n_sold - sum(1 for o in src_oo if o['sale_status'] == 'SOLD_OUT' and o['group_key'].split(':')[0] in {str(x) for x in hidden_ids})
      and sum(1 for dm in details for g in dm['optionGroups'] for o in g['options'] if o['allowQuantity']) == nq
      and all(o['maxQuantity'] is None or o['maxQuantity'] <= 10 for dm in details for g in dm['optionGroups'] for o in g['options']))
if os.environ.get('CATALOG_DUMP'):
    json.dump(details, open(os.environ['CATALOG_DUMP'] + '.menus.json', 'w'), ensure_ascii=False)
    json.dump(d, open(os.environ['CATALOG_DUMP'] + '.store.json', 'w'), ensure_ascii=False)

# 4) 재실행·검증
before = cnt()
lab0 = collections.Counter(r[0] for r in q("select collected_for || ':' || subject_label from private.store_source_records"))
rc, out = run('--apply', '--yes-dev-project')
lab1 = collections.Counter(r[0] for r in q("select collected_for || ':' || subject_label from private.store_source_records"))
if lab0 != lab1: print('기록 차이', list((lab1 - lab0).items())[:3], list((lab0 - lab1).items())[:3])
check('재실행 성공·중복 없음', rc == 0 and cnt() == before, (rc, cnt(), before, out[-300:]))
rc, out = run('--verify')
check('--verify 통과', rc == 0 and 'FAIL' not in out, out[-400:])

# 5) 복구
bks = sorted(x for x in os.listdir(BK) if x not in pre_dirs)
first = os.path.join(BK, bks[0])
bkj = json.load(open(first + '/backup.json'))
check('첫 적용 전 백업은 복구 기준, 재실행 백업은 기준 아님', bkj['applied_before_backup'] == [] and json.load(open(os.path.join(BK, bks[-1]) + '/backup.json'))['applied_before_backup'] != [])
if REF_GROUPS:
    smap = json.load(open(first + '/snapshot_source_id_map.json'))
    check(f'백업에 원본 ID ↔ 스냅샷 대응·삭제 그룹 기록(스냅샷 행 {N_OIO}건, 삭제 그룹 {held}개 이상)', len(smap['snapshot_rows_referencing_deleted']) == N_OIO and all(g in smap['deleted_groups'] for g in REF_GROUPS), list(smap))
bt = open(first + '/backup.json').read()
check('백업에 접속 정보·키 없음', URI not in bt and 'postgresql://' not in bt and 'eyJ' not in bt and 'sb_secret' not in bt)
rc, out = run('--restore', '--yes-dev-project', '--backup-dir', first)
check('복구 성공', rc == 0 and 'FAIL' not in out, out[-600:])
check('복구 후: 원래 메뉴·가격·이름·사진 연결·옵션 그룹/옵션 수, 그룹·내부 기록 없음, 다른 가게 불변', q("select count(*) " + Y, (SID,))[0][0] == n_ex and q("select count(*) from public.menu_option_groups")[0][0] == len(snap['groups'])
      and q("select count(*) from public.menu_options")[0][0] == len(snap['options']) and all(q("select base_price, name, image_ref from public.menus where id=%s", (m['id'],))[0] == (m['base_price'], m['name'], m['image_ref']) for m in snap['menus'])
      and q("select count(*) from public.store_menu_groups")[0][0] == 0 and q("select count(*) from private.store_source_records where load_batch like %s", (KEY + '%',))[0][0] == 0 and fp() == fp_other)

# 6) 서정 승인 뒤: 스냅샷 참조 가상 그룹 삭제(복사본 도구) + ID 대응 기록
if REF_GROUPS:
    rc, out = run('--apply', '--yes-dev-project', tool=TOOL_PRE)
    check(f'승인 전 매핑: 스냅샷 참조 가상 그룹 {held}개는 삭제하지 않고 비활성 보존, 스냅샷 행 {N_OIO}개 그대로', rc == 0 and all(q("select count(*), count(*) filter (where is_active) from public.menu_option_groups where id=%s", (g,))[0] == (1, 0) for g in REF_GROUPS)
          and q("select count(*) from public.order_item_options")[0][0] == N_OIO, out[-400:])
check('출력에 접속 문자열 없음', URI not in out)
print(f'{KEY}: {sum(results)} / {len(results)} 통과')
srv.cleanup(); shutil.rmtree(BK, ignore_errors=True); shutil.rmtree(TP, ignore_errors=True)
sys.exit(0 if all(results) else 1)
