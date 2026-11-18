# -*- coding: utf-8 -*-
"""연결·업로드·예외 경로에서 비밀값이 출력되지 않는지 확인한다.
모든 비밀값은 이 파일 안의 '가짜' 값이다. 실제 비밀번호·키를 넣지 않는다.
실행: python -m unittest test_redaction  (연결 시험에는 psycopg2가 필요하다)"""
import http.server
import os
import subprocess
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

FAKE_HEAD = 'Zq7fakeHd'
FAKE_TAIL = 'Tl9x'
FAKE_PW = '[' + FAKE_HEAD + '@' + FAKE_TAIL + ']'  # 대시보드 자리표시 괄호 + 비밀번호 안의 @ (실제로 사고가 난 모양)
FAKE_HOST = 'aws-0-fake-region.pooler.invalid'
FAKE_DB = f'postgresql://postgres.fakeref:{FAKE_PW}@{FAKE_HOST}:5432/postgres'
FAKE_SVC = 'fake-service-key-0123456789abcdef'
FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJmYWtlIjoiZmFrZSJ9.ZmFrZXNpZ25hdHVyZQ'
FAKE_ENV = {'DATABASE_URL': FAKE_DB, 'SUPABASE_SERVICE_ROLE_KEY': FAKE_SVC, 'SUPABASE_URL': 'http://127.0.0.1:9',
            'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY': FAKE_JWT}
SECRET_PIECES = [FAKE_HEAD, FAKE_TAIL + ']@', FAKE_SVC, FAKE_JWT, FAKE_PW, FAKE_DB]


def clean_env():
    env = {k: v for k, v in os.environ.items() if k not in FAKE_ENV and k != 'SUPABASE_PUBLISHABLE_KEY'}
    env.update(FAKE_ENV)
    return env


def assert_clean(test, text):
    for piece in SECRET_PIECES:
        test.assertNotIn(piece, text, '비밀값 조각이 출력에 남았다')


class RedactionTests(unittest.TestCase):
    def setUp(self):
        self._saved = {k: os.environ.get(k) for k in FAKE_ENV}
        os.environ.update(FAKE_ENV)
        import importlib
        import import_goobne
        self.T = importlib.reload(import_goobne)

    def tearDown(self):
        for k, v in self._saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

    def test_secret_values_include_password_pieces(self):
        vals = self.T.secret_values()
        for piece in (FAKE_DB, FAKE_SVC, FAKE_HEAD, FAKE_TAIL):
            self.assertIn(piece, vals)

    def test_redact_masks_libpq_style_host_error(self):
        msg = f'could not translate host name "{FAKE_TAIL}]@{FAKE_HOST}" to address: Name or service not known'
        out = self.T.redact(msg)
        assert_clean(self, out)
        self.assertIn('***', out)

    def test_redact_masks_url_password_even_if_not_in_env(self):
        out = self.T.redact('postgresql://user:SomeOtherFakePw@example.invalid:5432/db failed')
        self.assertNotIn('SomeOtherFakePw', out)

    def test_redact_masks_tokens(self):
        out = self.T.redact(f'Authorization: Bearer {FAKE_JWT} / {FAKE_SVC} / sb_secret_AbCdEf123456')
        assert_clean(self, out)
        self.assertNotIn('AbCdEf123456', out)

    def test_safe_error_keeps_code_and_type_only(self):
        class FakeDbError(Exception):
            pgcode = '28P01'
        out = self.T.safe_error(FakeDbError(f'password authentication failed for {FAKE_HEAD}@{FAKE_TAIL}'))
        self.assertIn('FakeDbError[28P01]', out)
        assert_clean(self, out)

    def test_storage_error_body_is_masked(self):
        """서버가 요청 내용(키)을 응답 본문에 되돌려 주는 경우에도 실패 목록에 키가 남지 않는다."""
        class LeakyHandler(http.server.BaseHTTPRequestHandler):
            def _leak(self):
                body = f'{{"error":"bad","echo":"{FAKE_SVC} {FAKE_HEAD}"}}'.encode()
                self.send_response(400)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            do_POST = do_GET = _leak

            def log_message(self, *a):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), LeakyHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            os.environ['SUPABASE_URL'] = f'http://127.0.0.1:{server.server_port}'
            with tempfile.NamedTemporaryFile(suffix='.png', delete=False) as f:
                f.write(b'\x89PNG\r\n\x1a\nfake')
            plan = {'photos': [{'local_path': f.name, 'object_path': 'menus/fake.png', 'mime': 'image/png', 'sha256': '0' * 64}]}
            done, failed = self.T.upload_photos(plan)
            os.unlink(f.name)
        finally:
            server.shutdown()
        self.assertEqual(done, [])
        self.assertEqual(len(failed), 1)
        assert_clean(self, repr(failed))


class UploadRetryTests(unittest.TestCase):
    """이미 올라가 있는 파일을 확인하려고 내려받다가 한 번 실패해도, 같은 파일이면 다시 시도해 성공으로 센다(다른 파일이면 덮어쓰지 않고 실패)."""

    def _serve(self, content, fail_gets):
        state = {'gets': 0}

        class H(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(400)
                body = b'{"statusCode":"409","error":"Duplicate"}'
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                state['gets'] += 1
                if state['gets'] <= fail_gets:
                    self.send_response(503)
                    self.send_header('Content-Length', '0')
                    self.end_headers()
                    return
                self.send_response(200)
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            def log_message(self, *a):
                pass
        server = http.server.HTTPServer(('127.0.0.1', 0), H)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        return server

    def _run(self, remote, local, fail_gets):
        import hashlib
        import importlib
        os.environ.update(FAKE_ENV)
        import import_goobne
        T = importlib.reload(import_goobne)
        T.time.sleep = lambda *_: None
        server = self._serve(remote, fail_gets)
        try:
            os.environ['SUPABASE_URL'] = f'http://127.0.0.1:{server.server_port}'
            with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f:
                f.write(local)
            plan = {'photos': [{'local_path': f.name, 'object_path': 'menus/x.jpg', 'mime': 'image/jpeg', 'sha256': hashlib.sha256(local).hexdigest()}]}
            result = T.upload_photos(plan)
            os.unlink(f.name)
            return result
        finally:
            server.shutdown()

    def test_same_file_after_transient_read_failures_counts_as_done(self):
        done, failed = self._run(b'same-bytes', b'same-bytes', fail_gets=2)
        self.assertEqual(done, ['menus/x.jpg'])
        self.assertEqual(failed, [])

    def test_different_file_is_never_overwritten_and_counts_as_failure(self):
        done, failed = self._run(b'server-bytes', b'local-bytes', fail_gets=0)
        self.assertEqual(done, [])
        self.assertEqual(len(failed), 1)
        self.assertIn('다르다', failed[0][2])


class SubprocessTests(unittest.TestCase):
    def run_tool(self, *args, code=None):
        cmd = [sys.executable, os.path.join(HERE, 'import_goobne.py'), *args] if code is None else [sys.executable, '-c', code]
        return subprocess.run(cmd, env=clean_env(), capture_output=True, text=True, timeout=120, cwd=HERE)

    def test_connect_failure_output_has_no_secret(self):
        """실제로 사고가 난 경로: 대괄호·@ 가 든 연결 문자열로 --check 를 실행하면 오류가 난다. 출력에 비밀 조각이 없어야 한다."""
        r = self.run_tool('--check', '--package', tempfile.gettempdir())
        self.assertNotEqual(r.returncode, 0)
        out = r.stdout + r.stderr
        assert_clean(self, out)
        self.assertTrue('DB 연결 실패' in out or 'psycopg2' in out)

    def test_unhandled_exception_output_has_no_secret(self):
        code = (
            "import sys; sys.path.insert(0, %r)\n"
            "import import_goobne as T\n"
            "T.install_safe_excepthook()\n"
            "raise RuntimeError('boom %s %s host name \"%s]@%s\" Bearer %s')\n"
        ) % (HERE, FAKE_DB, FAKE_SVC, FAKE_TAIL, FAKE_HOST, FAKE_JWT)
        r = self.run_tool(code=code)
        self.assertNotEqual(r.returncode, 0)
        out = r.stdout + r.stderr
        assert_clean(self, out)
        self.assertIn('RuntimeError', out)

    def test_urlerror_traceback_has_no_secret(self):
        """연결이 거부되는 주소로 사진 API를 부르는 처리되지 않은 예외도 키가 출력되지 않는다."""
        code = (
            "import sys; sys.path.insert(0, %r)\n"
            "import import_goobne as T\n"
            "T.install_safe_excepthook()\n"
            "T.storage_request('GET', '/storage/v1/bucket/menu-images')\n"
        ) % HERE
        r = self.run_tool(code=code)
        self.assertNotEqual(r.returncode, 0)
        assert_clean(self, r.stdout + r.stderr)


if __name__ == '__main__':
    unittest.main()
