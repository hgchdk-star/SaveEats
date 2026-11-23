#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
개발 전용 미리보기 서버(서버 적용 전 로컬 검증용). 수집 사진을 내 컴퓨터에서 읽어 앱에 보여 준다. DB·Storage에는 아무것도 쓰지 않는다.

  python preview_server.py --package <수집 폴더> [--port 8099]
  앱: EXPO_PUBLIC_STORE_PHOTO_PREVIEW_URL=http://<내 컴퓨터 IP>:8099 (개발 모드에서만 동작) 로 Expo를 띄운다.

  GET /preview/stores/<가게 UUID>.json   → {"imageRef": 대표 경로, "photos": [{"imageRef": ...}, ...]}  (대표 먼저, 나머지는 원본 순서)
  GET /img/<stores/UUID-해시.jpg>         → 수집 사진 파일
  GET /rep/<가게 UUID>?fallback=<URL>     → 그 가게의 새 대표사진(목록 카드용). 미리보기 대상이 아니면 fallback 주소로 돌려보낸다
"""
import argparse, io, json, os, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
ap = argparse.ArgumentParser()
ap.add_argument('--package', required=True)
ap.add_argument('--port', type=int, default=8099)
a = ap.parse_args()
M = json.load(io.open(os.path.join(BASE, 'stores_map.json'), encoding='utf-8'))['stores']
BY_ID = {s['store_id']: s for s in M}
FILES = {p['object_path']: os.path.join(a.package, p['local_path']) for s in M for p in s['photos']}


class H(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def send(self, code, body=b'', ctype='application/json', extra=None):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Access-Control-Allow-Origin', '*')
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        m = re.fullmatch(r'/preview/stores/([0-9a-f-]{36})\.json', u.path)
        if m and m.group(1) in BY_ID:
            s = BY_ID[m.group(1)]
            return self.send(200, json.dumps({'imageRef': s['photos'][0]['object_path'], 'photos': [{'imageRef': p['object_path']} for p in s['photos']]}).encode())
        m = re.fullmatch(r'/img/(stores/[0-9a-f-]{36}-[0-9a-f]{8}\.jpg)', u.path)
        if m and m.group(1) in FILES:
            return self.send(200, open(FILES[m.group(1)], 'rb').read(), 'image/jpeg')
        m = re.fullmatch(r'/rep/([0-9a-f-]{36})', u.path)
        if m:
            fb = parse_qs(u.query).get('fallback', [''])[0]
            if m.group(1) in BY_ID:
                return self.send(200, open(FILES[BY_ID[m.group(1)]['photos'][0]['object_path']], 'rb').read(), 'image/jpeg')
            if fb.startswith('https://'):
                return self.send(302, b'', 'text/plain', {'Location': fb})
        self.send(404, b'{}')


print(f'미리보기 서버: 0.0.0.0:{a.port}  (가게 {len(M)}곳, 사진 {len(FILES)}장). 중지는 Ctrl+C')
ThreadingHTTPServer(('0.0.0.0', a.port), H).serve_forever()
