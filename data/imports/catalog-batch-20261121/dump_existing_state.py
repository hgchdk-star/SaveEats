# -*- coding: utf-8 -*-
"""개발 서버를 읽기 전용으로 조회해 가게별 현재 상태(시험 픽스처 tests/fixtures/<key>/existing_state.json)를 만든다. 쓰기 없음, 접속 정보는 출력하지 않는다."""
import io, json, os, sys
os.environ.setdefault('CATALOG_STORE', sys.argv[1] if len(sys.argv) > 1 else 'bhc')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import import_store as T
T.load_env_file()
conn = T.G.connect(); conn.set_session(readonly=True); cur = conn.cursor()
st = T.load_existing(cur)
sid = T.STORE_ID
cur.execute("select code,name from public.categories where id=%s", (st['store']['category_id'],)); st['_category'] = list(cur.fetchone())
cur.execute("select menu_id::text,count(*) from public.order_items where store_id=%s group by 1", (sid,)); st['_order_items'] = {a: b for a, b in cur.fetchall()}
cur.execute("select rm.menu_id::text,count(*) from public.review_menus rm join public.menus m on m.id=rm.menu_id where m.store_id=%s group by 1", (sid,)); st['_reviews'] = {a: b for a, b in cur.fetchall()}
ks = ['menu_id', 'source_group_id', 'source_option_id', 'group_name_snapshot', 'option_name_snapshot', 'additional_price_snapshot', 'sort_order']
cur.execute("""select oi.menu_id::text, oio.source_group_id::text, oio.source_option_id::text, oio.group_name_snapshot, oio.option_name_snapshot, oio.additional_price_snapshot, oio.sort_order
               from public.order_item_options oio join public.order_items oi on oi.id=oio.order_item_id where oi.store_id=%s""", (sid,))
st['_oio'] = [dict(zip(ks, r)) for r in cur.fetchall()]
os.makedirs(os.path.join(T.BASE, 'tests', 'fixtures', T.STORE_KEY), exist_ok=True)
io.open(os.path.join(T.BASE, 'tests', 'fixtures', T.STORE_KEY, 'existing_state.json'), 'w', encoding='utf-8').write(json.dumps(st, ensure_ascii=False, indent=1, default=str))
print(T.STORE_KEY, 'menus', len(st['menus']), 'groups', len(st['groups']), 'options', len(st['options']), 'orders', st['_order_items'], 'reviews', st['_reviews'], 'snapshot opts', len(st['_oio']))
conn.close()
