# -*- coding: utf-8 -*-
"""
가게별 메뉴 대응표(menu_mapping.json)·옵션 정책(option_policy.json)·메뉴 그룹 표시명 제안(menu_group_display.json)을 만든다.
입력: 수집 자료(읽기 전용), 개발 서버 읽기 전용 조회로 만든 tests/fixtures/<key>/existing_state.json.
대응은 '이름이 같거나 표기 태그·띄어쓰기만 다르고 같은 상품'만 연결하고(기존 사진과 수집 사진을 눈으로 대조, 2026-11-22), 맛·용량·구성·세트가 다르면 연결하지 않는다.
사진: 메뉴에 사진 기록이 여럿이면(같은 원본의 400px 썸네일 + 1024px) 원본 첫 번째 사진의 1024px 파일을 대표로 제안한다. 서로 다른 사진이 둘이면 원본 첫 번째(전체가 보이는 사진)를 제안한다.
"""
import collections, io, json, os, sys
BASE = os.path.dirname(os.path.abspath(__file__))
PKG_ROOT = os.environ.get('CATALOG_PACKAGES') or sys.argv[1]
J = lambda p: json.load(io.open(p, encoding='utf-8'))

# 연결: (기존 메뉴 이름) → (수집 메뉴 원본 ID, 근거 분류, 근거)
LINKS = {
    'bhc': {
        '콰삭모짜킹': (125397639, 'NAME_COLLAB_TAG', "'[샘킴xbhc치킨]' 협업 표기만 다르고 같은 상품(순살 콰삭 치킨 + 모짜렐라, 딥소스 2종). 하프(4조각, 127341484)와는 구성이 달라 연결하지 않는다"),
        '커링클': (121003799, 'EXACT_NAME_PHOTO', '이름 동일, 기존 사진과 수집 사진이 같은 상품. 콤보·윙·스틱·순살과는 구성이 달라 연결하지 않는다'),
        '커링클/뿌링클 반반': (121003800, 'NAME_SUFFIX', "'치킨'만 덧붙은 이름, 같은 반반 구성(기존·수집 사진 동일 구성)"),
    },
    'momstouch': {
        '싸이버거': (116645403, 'NAME_SINGLE', "'단품'만 덧붙은 이름, 기존 사진은 버거 한 개이며 수집 '싸이버거 단품'과 같다. 세트(9,700원, 감자·음료 포함)와는 구성이 달라 연결하지 않는다"),
    },
    'megamgc': {
        '(HOT)헛개리카노': (108490158, 'NAME_SPACING', "띄어쓰기만 다른 이름, 같은 HOT 음료(기존·수집 사진 동일 구성)"),
        '(ICE)헛개리카노': (108490159, 'NAME_SPACING', "띄어쓰기만 다른 이름, 같은 ICE 음료. 왕메가 사이즈(108490160)와는 용량이 달라 연결하지 않는다"),
        '왕메가카페라떼': (108490272, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품(큰 용량 카페라떼, 기존 사진은 ONLY ICE 표시 포함)'),
        '할메가미숫커피': (108490163, 'NAME_ICE_TAG', "'(ICE)' 표기만 다르고 같은 상품(기존 사진도 아이스 음료). 수집 목록에 HOT 할메가미숫커피는 없다. 왕할메가·할메가커피와는 구성이 달라 연결하지 않는다"),
    },
    'misoya': {
        '히레카츠': (111123200, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품. 정식(111123201)·SET(111123202)과는 구성이 달라 연결하지 않는다'),
        '치즈 돈카츠': (111123207, 'NAME_SPACING', "띄어쓰기만 다른 이름, 같은 상품(기존·수집 사진 동일 구성). 정식·세트와는 연결하지 않는다"),
        '통살생선카츠': (111123203, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품. 정식·SET·1pc 추가와는 연결하지 않는다'),
        '돈카츠동': (111123173, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품. 정식(111123174)과는 연결하지 않는다'),
        '치킨가라아게동': (111123175, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품. 정식(111123176)과는 연결하지 않는다'),
    },
    'bonjuk': {
        '삼계죽': (54481148, 'NAME_TAG_PHOTO', "'(보양)' 분류 표기만 다르고 같은 죽(기존·수집 사진 동일 음식)"),
        '추어죽': (92366720, 'NAME_TAG_PHOTO', "'(보양)' 분류 표기만 다르고 같은 죽"),
        '삼계전복죽': (54481083, 'NAME_TAG_PHOTO', "'(보양)' 분류 표기만 다르고 같은 죽"),
        '소불고기나물비빔밥': (54481093, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품'),
    },
    'sinjeon': {
        '쌀떡볶이': (63401088, 'NAME_COMPOSITION', "구성 설명('통가래떡4 + 오뎅3')만 덧붙은 이름, 같은 쌀떡볶이(기존·수집 사진 동일 음식, 가격 4,500원 동일). 일반 떡볶이(1915492)와는 연결하지 않는다"),
        '치즈떡볶이': (1915500, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품(용기·촬영만 다름)'),
        '로제떡볶이': (17537875, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품. 마라로제떡볶이(68720495)와는 맛이 달라 연결하지 않는다'),
        '튀김오뎅': (1915503, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품'),
    },
    'jjambbongjizon': {
        '지존짬뽕': (94175476, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품(기존·수집 사진 모두 짬뽕). 지존짬뽕밥과는 연결하지 않는다'),
        '순두부짬뽕면': (94175480, 'EXACT_NAME_PHOTO', '이름 동일, 같은 상품. 순두부짬뽕밥(94175479)과는 연결하지 않는다'),
        '지존짬뽕밥': (94175482, 'EXACT_NAME', '이름 동일, 같은 상품(기존 사진 없음)'),
    },
    'pizzaschool': {
        '고구마피자': (81310909, 'EXACT_NAME_PHOTO', '이름 동일(12,900원 동일), 같은 상품. 콜라 콤보(124650785)·불닭고구마피자와는 연결하지 않는다'),
        '콘치즈피자': (109630420, 'EXACT_NAME', '이름 동일(12,900원 동일), 같은 상품(기존 사진 없음). 주문 1건·리뷰 1건 유지'),
        '콤비네이션피자': (81310934, 'EXACT_NAME_PHOTO', '이름 동일(12,900원 동일), 같은 상품'),
        '핫치킨피자': (81310935, 'EXACT_NAME_PHOTO', '이름 동일(12,900원 동일), 같은 상품'),
        '포테이토피자 (베이컨포테이토피자)(오리지널)': (81310910, 'NAME_STEM_EDGE', "이름 앞부분이 '포테이토피자'이고 가격 13,900원이 같다. 괄호의 '(오리지널)'은 수집 상세의 엣지 선택 기본값 '오리지널'(0원)과 같다(기존 사진 없음). 갈릭·트러플·오지치즈·아이리쉬 포테이토와는 구성이 달라 연결하지 않는다"),
    },
}
# 수집 목록에 없는 기존 메뉴: (이유)
REMOVE = {
    'momstouch': {
        '휠렛버거': "수집본의 '휠렛버거'는 세트(감자·음료 포함, 9,800원)뿐이고 단품이 없다. 기존 사진은 버거 한 개라 세트와 구성이 달라 연결하지 않는다",
        '통다리살 치킨버거+음료': '수집 목록에 같은 상품이 없다(비활성 개발용 메뉴, 사진·참조 없음)',
        '할라피뇨통살치킨버거': '수집 목록에 같은 상품이 없다(수집본에는 할라피뇨너겟만 있다, 비활성 개발용 메뉴)',
        '간장마늘 통다리살버거': '수집 목록에 같은 상품이 없다(비활성 개발용 메뉴)',
    },
    'megamgc': {'초코젤라또 말차라떼': '수집 목록에 같은 상품이 없다(젤라또 토핑은 다른 메뉴의 옵션으로만 있다). 주문 1건·리뷰 1건이 가리켜 삭제하지 않고 숨김 보존'},
    'bonjuk': {'본죽장조림버터비빔밥': "수집 목록에 같은 상품이 없다(수집 비빔밥: 낙지김치·신짬뽕·소불고기나물·6가지나물·제육볶음나물)"},
    'sinjeon': {'신전치즈김밥': "수집본에는 '신전매콤치즈김밥'(4,500원)과 '신전매콤김밥'만 있고 '신전치즈김밥'이 없다. 기존 사진은 매콤치즈김밥과 비슷해 보이지만 '매콤'은 맛이 다르다는 규칙에 따라 자동 연결하지 않는다(서정 결정 항목). 주문 1건·리뷰 1건이 가리켜 삭제하지 않고 숨김 보존"},
    'jjambbongjizon': {
        '새우볶음밥': "수집 목록에 같은 상품이 없다(수집본은 게살볶음밥 14,000원, 비활성 아님·참조 없음)",
        '찹쌀탕수육 소': "수집본의 '찹쌀탕수육'(기본 14,500원)은 상세에서 사이즈(1인 +500·소 +4,500·중 +11,500)를 고르는 메뉴라서 '소' 단일 메뉴와 구성이 다르다. 자동 연결하지 않는다(서정 결정 항목)",
    },
}
HIDDEN = {   # 주류·리뷰이벤트 메뉴(수집 원본 ID): 원본은 보존하고 앱에서는 숨기는 것이 최신 정책(FR-DATA-030·035) 기본안
    'bhc': {'group': ['주류']},
    'jjambbongjizon': {'group': ['주류메뉴', '리뷰이벤트']},
}
DISPLAY = {   # 앱 표시명 제안(원본 이름은 DB source_name에 보존)
    'bhc': {'[와우전용] 이츠셰프컬렉션': ('셰프컬렉션', "굽네·도미노에서 승인된 표시명과 같다. '[와우전용]'은 쿠팡이츠 멤버십 혜택 표시이고 '이츠'는 서비스 이름이라 SaveEats 혜택으로 오인되지 않게 뺀다")},
    'megamgc': {'쿠팡이츠 단독 메뉴': ('단독 메뉴', "'쿠팡이츠'는 외부 서비스 이름이라 SaveEats 앱에서 오인될 수 있어 서비스 이름을 뺀 이름을 제안한다. 메뉴 2개를 묶은 수집 그룹이며 혜택은 아니다")},
}


def main():
    out = {}
    for key, links in LINKS.items():
        pass
    from build_stores import STORES
    for key, sid, sname, branch, src in STORES:
        sd = os.path.join(BASE, 'stores', key)
        P = os.path.join(PKG_ROOT, f'{key}-coupangeats-20261121')
        ex = J(os.path.join(BASE, 'tests', 'fixtures', key, 'existing_state.json'))
        ms = {m['source_menu_id']: m for m in J(P + '/menus.json')}
        ex_by_name = {m['name']: m for m in ex['menus']}
        assert len(ex_by_name) == len(ex['menus']), key
        lk, rm = [], []
        for name, (src_id, basis, ev) in LINKS.get(key, {}).items():
            e = ex_by_name[name]; s = ms[src_id]
            lk.append(dict({'existing_menu_id': e['id'], 'existing_name': name, 'source_menu_id': src_id, 'source_name': s['name'].strip(), 'status': 'LINK', 'basis': basis, 'evidence': ev},
                           **({'rename_to_source': True} if name != s['name'].strip() else {})))
        for name, reason in REMOVE.get(key, {}).items():
            e = ex_by_name[name]
            rm.append({'existing_menu_id': e['id'], 'existing_name': name, 'reason': reason})
        assert {l['existing_name'] for l in lk} | {r['existing_name'] for r in rm} == set(ex_by_name), (key, set(ex_by_name) - {l['existing_name'] for l in lk} - {r['existing_name'] for r in rm})
        io.open(os.path.join(sd, 'menu_mapping.json'), 'w', encoding='utf-8').write(json.dumps({
            '_comment': f'기존 {sname} 메뉴 ↔ 수집({branch}) 메뉴 대응표(2026-11-22 준비, 서정 확인 전). 이름이 같거나 표기 태그·띄어쓰기만 다르고 같은 상품인 것만 연결한다. 가격은 수집 가격으로 갱신한다(지점 가격을 대표값으로 쓰는 기존 결정).',
            'links': lk, 'remove': rm, 'approved_snapshot_referenced_group_ids': [],
            '_approved_note': '주문 스냅샷이 원본 ID로 가리키는 기존 가상 옵션 그룹은 서정이 삭제를 승인한 뒤 여기에 그룹 id를 넣는다. 그 전에는 삭제하지 않고 비활성으로 보존한다.'}, ensure_ascii=False, indent=2) + '\n')
        # 옵션 정책
        mg = J(P + '/menu_groups.json')
        hid_groups = HIDDEN.get(key, {}).get('group', [])
        hidden_ids = []
        for g in mg:
            if g['name'] in hid_groups:
                hidden_ids += [i for i in g['menu_ids'] if i not in hidden_ids]
        ph = J(P + '/photo_index.json')
        by = collections.defaultdict(list)
        for p in ph:
            if p['status'] == 'downloaded':
                by[p['source_menu_id']].append(p)
        choice = {}
        from PIL import Image
        def ah(im, n=16):
            g = im.convert('L').resize((n, n)); px = list(g.getdata()); a = sum(px) / len(px); return [1 if q > a else 0 for q in px]
        for sid_, v in by.items():
            if len({x['sha256'] for x in v}) <= 1:
                continue
            first = ms[sid_]['image_urls'][0].split('/image/')[-1]
            cand = sorted([x for x in v if first in x['source_url']], key=lambda x: -x['bytes'])
            assert cand, (key, sid_)
            others = [x for x in v if first not in x['source_url']]
            if others:
                reason = '원본 imagePaths의 첫 번째 사진(1024px)을 대표로 제안. 실제 이미지 비교: 같은 상품을 다른 각도·구도로 찍은 사진이 둘이고, 첫 번째는 상품 전체가 보이는 사진이다. 둘째 사진과 모든 원본은 수집 폴더에 보존한다'
            else:
                a = ah(Image.open(os.path.join(P, cand[0]['local_path']))); b = ah(Image.open(os.path.join(P, v[0]['local_path']) if v[0] is not cand[0] else os.path.join(P, v[-1]['local_path'])))
                d = sum(x != y for x, y in zip(a, b))
                reason = f'같은 원본 사진의 400px 썸네일과 1024px 파일(이미지 해시 거리 {d}/256, 같은 구도). 해상도가 큰 1024px를 대표로 제안. 썸네일과 모든 원본은 수집 폴더에 보존한다'
            choice[str(sid_)] = {'sha256': cand[0]['sha256'], 'menu': ms[sid_]['name'].strip(), 'reason': reason}
        io.open(os.path.join(sd, 'option_policy.json'), 'w', encoding='utf-8').write(json.dumps({
            '_comment': '원본 ID/키로 지정하는 정책 대상(이름으로 규칙을 만들지 않는다). hidden_menu_source_ids: 주류·리뷰이벤트 메뉴(수집 원본은 보존, 앱 노출 여부는 --hide-menus 결정). photo_choice: 사진이 여럿인 메뉴의 대표 사진 제안(수집 원본은 모두 보존).',
            'hidden_menu_source_ids': hidden_ids, 'none_option_source_ids': [], 'review_event_source_group_ids': [], 'included_group_keys': [], 'included_group_reference': [],
            'photo_choice': choice}, ensure_ascii=False, indent=1) + '\n')
        disp = {'_comment': '앱 표시명 제안(서정 확인 대상). 원본 이름은 DB source_name과 내부 기록에 보존한다.' if DISPLAY.get(key) else f'앱 표시명 제안. {sname} 그룹명에는 외부 서비스 혜택·할인 표현이 없어 정리 제안이 없다(원본 그대로).'}
        for g in mg:
            if g['name'] in DISPLAY.get(key, {}):
                dn, why = DISPLAY[key][g['name']]
                disp[str(g['source_group_id'])] = {'source_name': g['name'], 'display_name': dn, 'reason': why}
        io.open(os.path.join(sd, 'menu_group_display.json'), 'w', encoding='utf-8').write(json.dumps(disp, ensure_ascii=False, indent=2) + '\n')
        print(key, 'links', len(lk), 'remove', len(rm), 'hidden', len(hidden_ids), 'photo_choice', len(choice))


if __name__ == '__main__':
    main()
