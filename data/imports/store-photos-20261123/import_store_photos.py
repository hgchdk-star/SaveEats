#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
기존 SaveEats 가게 16곳의 대표사진 교체와 상세 사진 갤러리 적용 도구 (개발 서버 전용).
수집본: 쿠팡이츠 가게 상단 이미지 66장(store.get_store_with_menu:data.imagePaths). 사진 사용 권한은 '미확인'으로 기록한다.

  --check    읽기 전용. 가게 UUID·이름·상태, 수집 파일 해시, 경로 규칙, 기존 대표사진·갤러리 행을 보고서(out/check_report.md)로 만든다
  --backup   적용 전 상태(stores.image_ref, store_photos 행, 기존 대표사진 파일, 출처 기록, 메뉴·주문 해시, 다른 가게 해시)를 backup/<가게 키>/<시각>/ 에 저장
  --apply    가게마다 독립: 재확인 → 백업 → 사진 업로드(실패하면 이 가게의 DB 변경 전에 멈춤) → DB 한 트랜잭션(안에서 검증) → Guest 검증
  --verify   쓰기 없는 점검(DB·Guest·파일 해시 대조, 변경 없음 점검)
  --restore  최초 적용 전 백업 기준으로 가게 하나를 되돌린다

규칙
  - 새 파일은 별도 경로 stores/<가게 UUID>-<해시 앞 8자리>.jpg 로만 올린다. 기존 stores/<UUID>.<확장자> 파일은 지우지 않는다(주문 스냅샷·구버전 앱).
  - stores.image_ref = 대표(sort_order 0)와 같은 새 경로, store_photos = 대표 + 나머지 원본 순서. 메뉴·가격·옵션·주문·리뷰·스냅샷은 건드리지 않는다.
  - 접속 정보는 환경변수나 .env.import(저장소 제외)로만 읽고 출력하지 않는다.
"""
import argparse, datetime, hashlib, io, json, os, re, sys, urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(BASE), 'goobne-coupangeats-20261117'))
import import_goobne as G  # noqa: E402

DEV_REF = 'msiahbzzebgjsoanjbtx'
BATCH = 'store-photos-coupangeats-20261123'
BUCKET = G.BUCKET
G.BUCKET = BUCKET
# 앱(resolveImageUrl)·DB 제약과 같은 모양
APP_PATH = re.compile(r'^(?:menus|stores)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[0-9a-f]{8})?\.(?:png|jpe?g)$', re.I)
safe_error = G.safe_error


def uid(*parts):
    return G.uid(*parts)


def load_env_file():
    path = os.path.join(BASE, '.env.import')
    if os.path.exists(path):
        for line in io.open(path, encoding='utf-8'):
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, v = line.split('=', 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def read_map():
    return json.load(io.open(os.path.join(BASE, 'stores_map.json'), encoding='utf-8'))


def new_backup_dir(key, suffix=''):
    root = os.environ.get('STORE_PHOTOS_BACKUP_ROOT') or os.path.join(BASE, 'backup')
    base = os.path.join(root, key, datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + suffix)
    d, n = base, 1
    while os.path.exists(d):
        n += 1
        d = f'{base}-{n}'
    return d


# ---------------------------------------------------------------- 계획·점검
def build_plan(package, s, cur):
    issues, notes = [], []
    cur.execute('select id::text, name, image_ref, is_active, is_open, is_recommended from public.stores where id = %s', (s['store_id'],))
    st = cur.fetchone()
    if not st:
        issues.append('SaveEats 가게가 없다')
        st = (s['store_id'], None, None, None, None, None)
    elif st[1] != s['store_name']:
        issues.append(f'가게 이름이 매핑과 다르다: {st[1]} / {s["store_name"]}')
    if st[3] is False:
        issues.append('비활성 가게')
    cur.execute("select count(*) from information_schema.tables where table_schema = 'public' and table_name = 'store_photos'")
    has_table = cur.fetchone()[0] == 1
    if not has_table:
        issues.append('서버에 store_photos 테이블(migration 20261123144759_store_photos.sql)이 아직 없다')
    existing = []
    if has_table:
        cur.execute('select image_ref, sort_order, source_position, is_active from public.store_photos where store_id = %s order by sort_order', (s['store_id'],))
        existing = [dict(zip(('image_ref', 'sort_order', 'source_position', 'is_active'), r)) for r in cur.fetchall()]
    photos = []
    for p in s['photos']:
        path = os.path.join(package, p['local_path'])
        if not os.path.exists(path):
            issues.append(f'사진 파일이 없다: {p["local_path"]}')
            continue
        data = open(path, 'rb').read()
        if hashlib.sha256(data).hexdigest() != p['sha256']:
            issues.append(f'사진 해시가 다르다: {p["local_path"]}')
        ext, mime = G.sniff_image(path)
        if ext != 'jpg' and ext != 'jpeg':
            issues.append(f'JPG가 아니다: {p["local_path"]}')
        if len(data) > G.MAX_IMAGE_BYTES:
            issues.append(f'2MiB를 넘는다: {p["local_path"]}')
        if not APP_PATH.match(p['object_path']) or not p['object_path'].startswith('stores/' + s['store_id']):
            issues.append(f'앱 경로 규칙(resolveImageUrl)을 통과하지 못한다: {p["object_path"]}')
        photos.append(dict(p, local_path_abs=path, mime=mime))
    if len({p['object_path'] for p in photos}) != len(photos):
        issues.append('같은 경로가 둘 이상')
    if photos and photos[0]['sort_order'] != 0:
        issues.append('첫 장이 대표가 아니다')
    return {'store': s, 'db_store': st, 'existing_photos': existing, 'photos': photos, 'issues': issues, 'notes': notes, 'has_table': has_table,
            'old_ref': st[2], 'rep_ref': photos[0]['object_path'] if photos else None}


def render_report(plans):
    L = ['# 가게 대표사진·갤러리 적용 점검 보고서 (읽기 전용)', '', '| 가게 | UUID | 기존 대표사진 | 새 대표(원본 번호) | 갤러리 장수 | 기존 갤러리 행 | 오류 |', '|---|---|---|---|---|---|---|']
    for p in plans:
        s = p['store']
        L.append(f'| {s["store_name"]} | `{s["store_id"][:8]}…` | `{p["old_ref"]}` | `{p["rep_ref"]}` (원본 {s["representative_source_position"]}번) | {len(p["photos"])} | {len(p["existing_photos"])} | {"; ".join(p["issues"]) or "없음"} |')
    L += ['', f'- 사진 합계 {sum(len(p["photos"]) for p in plans)}장, 업로드 경로는 모두 별도 경로(기존 파일 보존).', '- 사진 권리 상태: 미확인(쿠팡이츠 가게 상단 이미지, store.get_store_with_menu imagePaths).']
    os.makedirs(os.path.join(BASE, 'out'), exist_ok=True)
    text = '\n'.join(L) + '\n'
    io.open(os.path.join(BASE, 'out', 'check_report.md'), 'w', encoding='utf-8').write(text)
    return text


# ---------------------------------------------------------------- 백업·적용·복구
def backup(plan, cur, d, fetch=True):
    s = plan['store']
    os.makedirs(d, exist_ok=False)
    cur.execute('select to_jsonb(s) from public.stores s where s.id = %s', (s['store_id'],))
    store_row = cur.fetchone()[0]
    cur.execute('select to_jsonb(p) from public.store_photos p where p.store_id = %s order by sort_order', (s['store_id'],))
    rows = [r[0] for r in cur.fetchall()]
    cur.execute('select to_jsonb(r) from private.store_source_records r where r.store_id = %s and r.load_batch = %s', (s['store_id'], BATCH))
    recs = [r[0] for r in cur.fetchall()]
    cur.execute(G.ORDER_FP_SQL, {'sid': s['store_id']}); order_fp = cur.fetchone()[0]
    cur.execute(G.FINGERPRINT_SQL, {'sid': s['store_id']}); other_fp = {r[0]: r[1] for r in cur.fetchall()}
    files = []
    if plan['old_ref'] and fetch:
        with urllib.request.urlopen(G.public_url(plan['old_ref']), timeout=60) as r:
            data = r.read()
        name = plan['old_ref'].replace('/', '__')
        os.makedirs(os.path.join(d, 'photo_files'))
        open(os.path.join(d, 'photo_files', name), 'wb').write(data)
        files.append({'object_path': plan['old_ref'], 'saved_as': 'photo_files/' + name, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    data = {'batch': BATCH, 'created_at': datetime.datetime.now().isoformat(timespec='seconds'), 'store_id': s['store_id'], 'store_key': s['key'], 'store_row': store_row,
            'store_photos_rows': rows, 'source_records': recs, 'photo_files': files, 'order_fingerprint': order_fp, 'other_store_fingerprints': other_fp,
            'applied_before_backup': [r['image_ref'] for r in rows], 'note': '이 백업에는 접속 정보가 없다. 적용 전 상태 기준 복구에만 쓴다'}
    G.write_json(os.path.join(d, 'backup.json'), data)
    return data


def apply_db(cur, plan):
    from psycopg2.extras import execute_values
    s = plan['store']
    sid = s['store_id']
    cur.execute('update public.stores set image_ref = %s where id = %s', (plan['rep_ref'], sid))
    cur.execute('delete from public.store_photos where store_id = %s', (sid,))
    execute_values(cur, 'insert into public.store_photos (id, store_id, image_ref, sort_order, source_position, is_active) values %s',
                   [(uid('store_photo', sid, p['sha256']), sid, p['object_path'], p['sort_order'], p['source_position'], True) for p in plan['photos']])
    note_src = f'쿠팡이츠 가게 상단 이미지(store.get_store_with_menu:data.imagePaths, 수집 지점 {s["branch_name"]}, source_store_id={s["source_store_id"]})'
    cur.execute('delete from private.store_source_records where store_id = %s and load_batch = %s', (sid, BATCH))
    execute_values(cur, """insert into private.store_source_records
          (store_id, url, collected_for, subject_label, host_kind, rights_permission, reuse_permission, evidence, note, checked_on, load_batch) values %s
        on conflict (store_id, url, collected_for, (coalesce(subject_label, ''))) do update set note = excluded.note, evidence = excluded.evidence, load_batch = excluded.load_batch""",
        [(sid, p['source_url'], 'IMAGE_PAGE', f'가게 사진 원본 {p["source_position"]}번' + (' (대표)' if p['sort_order'] == 0 else ''), 'PLATFORM', '미확인', '미확인',
          note_src + '. 개발 서버 적용이며 외부 공개 승인이 아님',
          f'{note_src} 원본 {p["source_position"]}번. 사진 사용 권한 미확인. SaveEats 경로 {p["object_path"]}, sha256 {p["sha256"][:12]}' + (f', 대표사진({s["representative_basis"]})' if p['sort_order'] == 0 else ', 상세 갤러리'),
          '2026-11-23', BATCH) for p in plan['photos']], page_size=200)


def restore_db(cur, plan, bk):
    sid = plan['store']['store_id']
    cur.execute('delete from public.store_photos where store_id = %s', (sid,))
    rows = bk['store_photos_rows']
    if rows:
        cur.execute('insert into public.store_photos select * from jsonb_populate_recordset(null::public.store_photos, %s::jsonb)', (json.dumps(rows),))
    cur.execute('update public.stores set image_ref = %s where id = %s', (bk['store_row']['image_ref'], sid))
    cur.execute('delete from private.store_source_records where store_id = %s and load_batch = %s', (sid, BATCH))


def verify(plan, cur, before=None, files=True):
    s = plan['store']; sid = s['store_id']
    res = []

    def check(name, ok, detail=''):
        res.append(bool(ok)); print(('PASS ' if ok else 'FAIL ') + f'[{s["key"]}] ' + name + ('' if ok else f'  -> {detail}'))
    cur.execute('select image_ref, name, is_open, is_active, is_recommended from public.stores where id = %s', (sid,))
    st = cur.fetchone()
    check('대표사진(stores.image_ref)이 새 대표 경로이다', st[0] == plan['rep_ref'], st[0])
    cur.execute('select image_ref, sort_order, source_position from public.store_photos where store_id = %s and is_active order by sort_order', (sid,))
    rows = cur.fetchall()
    check(f'갤러리 {len(plan["photos"])}장, 순서(대표 먼저, 나머지는 원본 순서)가 계획과 같다', [(r[0], r[1], r[2]) for r in rows] == [(p['object_path'], p['sort_order'], p['source_position']) for p in plan['photos']], rows)
    check('첫 장 = 대표사진, 나머지는 원본 위치 오름차순', rows and rows[0][0] == st[0] and [r[2] for r in rows[1:]] == sorted(r[2] for r in rows[1:]) and rows[0][2] == s['representative_source_position'])
    check('모든 경로가 앱 경로 규칙(resolveImageUrl)을 통과한다', all(APP_PATH.match(r[0]) for r in rows))
    cur.execute('select count(*) from private.store_source_records where store_id = %s and load_batch = %s and collected_for = %s and rights_permission = %s', (sid, BATCH, 'IMAGE_PAGE', '미확인'))
    check('사진마다 출처 기록(원본 위치·권한 미확인)이 있다', cur.fetchone()[0] == len(plan['photos']))
    if before is not None:
        check('가게 영업 상태·활성·추천 유지', st[2:] == (before['store_row']['is_open'], before['store_row']['is_active'], before['store_row']['is_recommended']))
        cur.execute(G.ORDER_FP_SQL, {'sid': sid})
        check('메뉴·옵션 주문·리뷰 스냅샷 해시 변경 없음', cur.fetchone()[0] == before['order_fingerprint'])
        cur.execute(G.FINGERPRINT_SQL, {'sid': sid})
        check('다른 가게 변경 없음', {r[0]: r[1] for r in cur.fetchall()} == before['other_store_fingerprints'])
    cur.execute('select count(*) from public.menus where store_id = %s', (sid,))
    n_menus = cur.fetchone()[0]
    if before is not None and 'menu_count' in before:
        check('메뉴 수 변경 없음', n_menus == before['menu_count'])
    ok = all(res)
    print(f'[{s["key"]}] {sum(res)} / {len(res)} 통과')
    return ok


def anon_verify(plan):
    base = os.environ.get('SUPABASE_URL') or os.environ.get('EXPO_PUBLIC_SUPABASE_URL')
    key = os.environ.get('SUPABASE_PUBLISHABLE_KEY') or os.environ.get('EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY')
    if not base or not key:
        sys.exit('anon 검증에는 SUPABASE_URL과 공개 키가 필요합니다.')
    s = plan['store']
    bad = []
    try:
        req = urllib.request.Request(base.rstrip('/') + '/rest/v1/rpc/get_store', data=json.dumps({'p_store_id': s['store_id']}).encode(), method='POST')
        req.add_header('apikey', key); req.add_header('Content-Type', 'application/json')
        d = json.loads(urllib.request.urlopen(req, timeout=30).read())
    except Exception as e:
        print(f'FAIL [{s["key"]}] get_store 조회 실패 ' + safe_error(e))
        return False
    if d.get('imageRef') != plan['rep_ref']:
        bad.append('imageRef')
    if [p['imageRef'] for p in d.get('photos', [])] != [p['object_path'] for p in plan['photos']]:
        bad.append('photos 순서·장수')
    if d.get('photos') and d['photos'][0]['imageRef'] != d['imageRef']:
        bad.append('첫 장≠대표')
    nph = 0
    for p in plan['photos']:
        try:
            with urllib.request.urlopen(G.public_url(p['object_path']), timeout=30) as r:
                if hashlib.sha256(r.read()).hexdigest() == p['sha256']:
                    nph += 1
        except Exception:
            pass
    if nph != len(plan['photos']):
        bad.append(f'사진 조회 {nph}/{len(plan["photos"])}')
    print(('PASS' if not bad else 'FAIL') + f' [{s["key"]}] Guest: get_store imageRef·photos {len(d.get("photos", []))}장 순서, 공개 URL 해시 {nph}/{len(plan["photos"])} 일치' + ('' if not bad else f' -> {bad}'))
    return not bad


def main():
    G.install_safe_excepthook()
    load_env_file()
    ap = argparse.ArgumentParser(description='가게 대표사진·상세 갤러리 적용(개발 서버 전용)')
    ap.add_argument('--package', required=True, help='수집 폴더(읽기 전용)')
    ap.add_argument('--stores', help='쉼표로 구분한 가게 키(기본 전체)')
    for f in ('check', 'backup', 'apply', 'verify', 'restore'):
        ap.add_argument('--' + f, action='store_true')
    ap.add_argument('--backup-dir', help='--restore: 이 가게의 적용 전 백업 폴더(--stores는 하나)')
    ap.add_argument('--yes-dev-project', action='store_true')
    ap.add_argument('--skip-photos', action='store_true', help='시험 전용: 사진 업로드·Guest 조회를 건너뜀')
    a = ap.parse_args()
    m = read_map()
    keys = a.stores.split(',') if a.stores else [s['key'] for s in m['stores']]
    stores = [s for s in m['stores'] if s['key'] in keys]
    conn = G.connect(); cur = conn.cursor()
    plans = [build_plan(a.package, s, cur) for s in stores]
    conn.rollback()
    writes = a.backup or a.apply or a.restore
    sup = os.environ.get('SUPABASE_URL') or ''
    if writes and not a.yes_dev_project:
        sys.exit(f'개발 프로젝트({DEV_REF})에만 씁니다. 확인했다면 --yes-dev-project 를 붙여 주세요.')
    if writes and sup and DEV_REF not in sup:
        sys.exit('SUPABASE_URL이 개발 프로젝트가 아닙니다. 중단합니다.')
    if a.check or not (a.backup or a.apply or a.verify or a.restore):
        print(render_report(plans))
        sys.exit(1 if any(p['issues'] for p in plans) else 0)
    exit_code = 0
    for plan in plans:
        s = plan['store']; key = s['key']
        try:
            if plan['issues']:
                print(f'[{key}] 보류: ' + '; '.join(plan['issues'])); exit_code = 1; continue
            if a.verify:
                bk_dir = a.backup_dir
                before = G.read_json(os.path.join(bk_dir, 'backup.json')) if bk_dir else None
                ok = verify(plan, cur, before) and (a.skip_photos or anon_verify(plan))
                conn.rollback(); exit_code |= 0 if ok else 1; continue
            if a.backup:
                d = new_backup_dir(key); bk = backup(plan, cur, d, not a.skip_photos); conn.rollback()
                print(f'[{key}] 백업 저장:', os.path.relpath(d, BASE)); continue
            if a.restore:
                if not a.backup_dir:
                    sys.exit('--restore 에는 --backup-dir 가 필요합니다')
                bk = G.read_json(os.path.join(a.backup_dir, 'backup.json'))
                if bk['store_key'] != key or bk['applied_before_backup']:
                    print(f'[{key}] 이 백업은 이 가게의 적용 전 백업이 아니다'); exit_code = 1; continue
                restore_db(cur, plan, bk); conn.commit()
                removed = 0
                if not a.skip_photos:
                    keep = {bk['store_row']['image_ref']}
                    for p in plan['photos']:
                        if p['object_path'] not in keep:
                            st, _ = G.storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}'); removed += st in (200, 204, 404)
                print(f'[{key}] 복구 완료(새 사진 {removed}개 삭제, 기존 대표사진 파일은 그대로)')
                cur.execute('select image_ref from public.stores where id = %s', (s['store_id'],))
                good = cur.fetchone()[0] == bk['store_row']['image_ref']
                cur.execute('select count(*) from public.store_photos where store_id = %s', (s['store_id'],))
                good = good and cur.fetchone()[0] == len(bk['store_photos_rows'])
                print(('PASS' if good else 'FAIL') + f' [{key}] 복구 확인'); conn.rollback(); exit_code |= 0 if good else 1; continue
            # --apply
            d = new_backup_dir(key, '-pre-apply'); bk = backup(plan, cur, d, not a.skip_photos); conn.rollback()
            cur.execute('select count(*) from public.menus where store_id = %s', (s['store_id'],)); bk['menu_count'] = cur.fetchone()[0]; conn.rollback()
            print(f'[{key}] 백업:', os.path.relpath(d, BASE))
            referenced = {r['image_ref'] for r in bk['store_photos_rows']} | {bk['store_row']['image_ref']}
            if not a.skip_photos:
                done, failed = G.upload_photos({'photos': [{'object_path': p['object_path'], 'local_path': p['local_path_abs'], 'mime': p['mime'], 'sha256': p['sha256']} for p in plan['photos']]})
                if failed:
                    for p_, st_, why in failed[:5]:
                        print('업로드 실패:', p_, st_, why)
                    print(f'[{key}] 사진 업로드 실패 → DB 반영 없이 이 가게만 멈춥니다(이번에 올린 새 파일 정리).')
                    for p in plan['photos']:
                        if p['object_path'] in done and p['object_path'] not in referenced:
                            G.storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}')
                    exit_code = 1; continue
                print(f'[{key}] 사진 업로드 {len(done)}장 완료')
            try:
                apply_db(cur, plan)
                print(f'[{key}] DB 반영(트랜잭션 안) 후 검증:')
                if not verify(plan, cur, bk):
                    raise RuntimeError('검증 실패')
                conn.commit()
            except Exception as e:
                conn.rollback()
                print(f'[{key}] DB 반영 실패(전체 되돌림): ' + safe_error(e))
                if not a.skip_photos:
                    for p in plan['photos']:
                        if p['object_path'] not in referenced:
                            G.storage_request('DELETE', f'/storage/v1/object/{BUCKET}/{p["object_path"]}')
                exit_code = 1; continue
            print(f'[{key}] 적용 완료.')
            if not a.skip_photos and not anon_verify(plan):
                exit_code = 1
        except SystemExit:
            raise
        except Exception as e:
            conn.rollback(); print(f'[{key}] 보류(예상 밖 오류): ' + safe_error(e)); exit_code = 1
    sys.exit(exit_code)


if __name__ == '__main__':
    main()
