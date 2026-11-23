#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
8개 가게를 한 번의 승인으로 차례대로 실행하는 실행기. 가게마다 import_store.py를 따로 실행하므로 서로 독립이다.

  python run_batch.py --package-root <ZIP을 푼 폴더> --decisions decisions.json --check            # 읽기 전용 점검(8개)
  python run_batch.py --package-root <...> --decisions decisions.json --apply --yes-dev-project     # 승인 뒤 실행
  python run_batch.py --package-root <...> --decisions decisions.json --restore-plan                 # 가게별 복구 명령 출력(실행하지 않음)

가게마다 순서: 1) 상태 재확인(--check, 오류·미결정·새 의존성이 있으면 이 가게를 보류) → 2) 적용 전 백업 → 3) 사진 업로드(실패하면 DB 반영 전 중단)
→ 4) DB 한 트랜잭션(안에서 검증, 실패하면 전체 되돌림) → 5) Guest 검증 → 6) 쓰기 없는 --verify(변경 없음 점검).
한 가게가 보류·실패해도 다음 가게는 계속한다(--stop-on-failure로 멈출 수 있다). 접속 정보·키·원본 오류는 출력하지 않는다(도구가 마스킹).
"""
import argparse, datetime, io, json, os, re, subprocess, sys
BASE = os.path.dirname(os.path.abspath(__file__))


def run(args):
    p = subprocess.run([sys.executable, os.path.join(BASE, 'import_store.py')] + args, capture_output=True, text=True)
    return p.returncode, p.stdout + p.stderr


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--package-root', required=True)
    ap.add_argument('--decisions', required=True)
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--apply', action='store_true')
    ap.add_argument('--restore-plan', action='store_true')
    ap.add_argument('--yes-dev-project', action='store_true')
    ap.add_argument('--only', help='쉼표로 구분한 가게 키만 실행')
    ap.add_argument('--stop-on-failure', action='store_true')
    a = ap.parse_args()
    dec = json.load(io.open(a.decisions, encoding='utf-8'))
    keys = [k for k in dec['order'] if not a.only or k in a.only.split(',')]
    rows, lines = [], []
    for k in keys:
        pkg = os.path.join(a.package_root, f'{k}-coupangeats-20261121')
        flags = dec['common'] + dec['stores'].get(k, [])
        base = ['--store', k, '--package', pkg] + flags
        status, detail, backup = '대기', '', ''
        if a.restore_plan:
            lines.append(f'# {k}: python import_store.py --store {k} --package <수집 폴더>/{k}-coupangeats-20261121 {" ".join(flags)} --restore --yes-dev-project --backup-dir backup/{k}/<적용 전 백업 폴더>')
            continue
        rc, out = run(base + ['--check'])
        if rc != 0 or '## 미결정·확인 필요' in out and re.search(r'^- (?!수집일|수량 상한).*\(--', out.split('## 미결정·확인 필요')[1], re.M):
            status, detail = '보류(재확인: 오류·미결정)', '\n'.join(l for l in out.splitlines() if l.startswith('- ') and '--' in l)[:300]
        elif a.check or not a.apply:
            status = '점검 통과(적용 안 함)'
        else:
            if not a.yes_dev_project:
                sys.exit('--apply 에는 --yes-dev-project 가 필요합니다')
            rc, out = run(base + ['--apply', '--yes-dev-project'])
            m = re.search(r'^백업: (\S+)', out, re.M)
            backup = m.group(1) if m else ''
            if rc != 0 or '적용 완료' not in out or 'FAIL' in out:
                status = '실패(해당 가게 보류, 트랜잭션 되돌림)'
                detail = '\n'.join(l for l in out.splitlines() if l.startswith(('FAIL', '업로드 실패', 'DB 반영 실패', '사진 업로드에', '미결정', '변환 검사')))[:400]
            else:
                # 재실행 점검은 쓰기 없는 --verify(변경 없음 점검: 계획의 모든 행이 이미 있고 개수가 같다, Guest·사진 대조 포함)로 한다
                rc2 = 0
                rc3, out3 = run(base + ['--verify', '--backup-dir', backup])
                status = '완료' if rc2 == 0 and rc3 == 0 and 'FAIL' not in out3 else '적용됨, 재실행/검증 확인 필요'
                detail = out3.strip().splitlines()[-1] if out3.strip() else ''
        rows.append((k, status, backup, detail))
        print(f'[{k}] {status} {backup}')
        if a.stop_on_failure and status.startswith(('보류', '실패')):
            break
    os.makedirs(os.path.join(BASE, 'out'), exist_ok=True)
    rep = ['# 일괄 실행 결과', f'- 시각: {datetime.datetime.now().isoformat(timespec="seconds")}', '', '| 가게 | 상태 | 적용 전 백업(복구 기준) | 비고 |', '|---|---|---|---|']
    rep += [f'| {k} | {s} | {b} | {d.replace(chr(10), " / ")} |' for k, s, b, d in rows]
    rep += [''] + lines
    io.open(os.path.join(BASE, 'out', 'batch_report.md'), 'w', encoding='utf-8').write('\n'.join(rep) + '\n')
    print('\n'.join(lines))
    sys.exit(0 if all(s.startswith(('완료', '점검 통과')) for _, s, _, _ in rows) or a.restore_plan else 1)


if __name__ == '__main__':
    main()
