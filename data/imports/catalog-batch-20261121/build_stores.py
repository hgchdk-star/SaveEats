# -*- coding: utf-8 -*-
"""
가게별 설정(stores/<key>/store.json)을 만든다. 기존 가게 UUID는 개발 서버를 읽기 전용으로 조회해 확인한 값이다(2026-11-22).
메뉴 대응표·옵션 정책은 build_policies.py가 만든다. 원본 자료는 읽기만 한다.
"""
import io, json, os
BASE = os.path.dirname(os.path.abspath(__file__))
STORES = [
    # key, 기존 가게 UUID, 기존 가게 이름, 수집 지점, 수집 가게 ID
    ('bhc', 'a3fa9f76-e7c1-568b-a59a-39c70b0084f9', 'BHC', 'BHC 홍은점', 820833),
    ('momstouch', '3ae1ca12-9429-5b13-aaef-41eda941b451', '맘스터치', '맘스터치 홍제역점', 691248),
    ('megamgc', '7dff7e39-2b54-584e-a981-06a1f54b5d76', '메가MGC커피', '메가MGC커피 홍제홍은벽산점', 953211),
    ('misoya', '0d37a1b6-46b7-5d50-a72b-2c619736941f', '미소야', '미소야 구산역점', 974233),
    ('bonjuk', '23fbc09f-d03f-5d87-a0b7-d8b4d3d8b989', '본죽&비빔밥', '본죽&비빔밥 홍은1동점', 551269),
    ('sinjeon', 'd84d5228-135a-5e51-a35d-6dea5513c9d8', '신전떡볶이', '신전떡볶이 상명대점', 140048),
    ('jjambbongjizon', '8b6c40b5-ff06-5f3d-a6f8-0d359246ff88', '짬뽕지존', '짬뽕지존 연신내점', 836082),
    ('pizzaschool', 'b6322307-c104-5044-a048-ac4c96a5409b', '피자스쿨', '피자스쿨 문화촌점', 371212),
]
if __name__ == '__main__':
    for key, sid, name, branch, src in STORES:
        d = os.path.join(BASE, 'stores', key)
        os.makedirs(d, exist_ok=True)
        io.open(os.path.join(d, 'store.json'), 'w', encoding='utf-8').write(json.dumps(
            {'key': key, 'store_id': sid, 'store_name': name, 'branch_name': branch, 'source_store_id': src, 'package_dir': f'{key}-coupangeats-20261121'},
            ensure_ascii=False, indent=2) + '\n')
    print(len(STORES), '개 가게 설정을 만들었다')
