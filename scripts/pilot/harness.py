#!/usr/bin/env python3
"""Evaluator-owned, provider-neutral bounded task pilot. Python standard library only."""
from __future__ import annotations
import argparse
import concurrent.futures
import difflib
import fnmatch
import hashlib
import json
import os
from pathlib import Path
import random
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import time

SCHEMA = 1
ENV_ALLOWLIST = {'PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'TEMP', 'TMP', 'LANG', 'TERM', 'SHELL', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'SYSTEMROOT', 'WINDIR'}


def child_environment():
    # Preserve local CLI authentication discovery without forwarding unrelated credentials.
    return {key: value for key, value in os.environ.items() if key in ENV_ALLOWLIST or key.startswith('LC_')}

IGNORED = {'.git', 'node_modules', '.pilot-tools', '__pycache__', '.pytest_cache'}
DEFAULT_PROTECTED = ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/__type_tests__/**', '**/fixtures/**', '**/package.json', '**/tsconfig*.json', '**/vitest*.ts', '**/vite.config.*', '**/AGENTS.md']


def digest(value):
    return hashlib.sha256(value).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def relative(value):
    path = Path(value)
    if not value or path.is_absolute() or '..' in path.parts or value == '.':
        raise ValueError(f'Expected bounded relative path: {value!r}')
    return value


def validate_manifest(m):
    if m.get('schemaVersion') != SCHEMA:
        raise ValueError('Unsupported schemaVersion')
    for key in ('studyId', 'outputRoot', 'provider', 'budgets', 'arms', 'tasks', 'seed', 'repeats'):
        if key not in m:
            raise ValueError(f'Missing {key}')
    if not isinstance(m['seed'], int) or isinstance(m['seed'], bool):
        raise ValueError('seed must be an integer')
    if not isinstance(m['repeats'], int) or isinstance(m['repeats'], bool) or not 1 <= m['repeats'] <= 100:
        raise ValueError('repeats must be 1..100')
    if m.get('maxConcurrency', 1) not in (1, 2):
        raise ValueError('maxConcurrency must be 1 or 2')
    timeout = m['budgets'].get('timeoutSeconds')
    if not isinstance(timeout, (int, float)) or isinstance(timeout, bool) or not 0 < timeout <= 720:
        raise ValueError('timeoutSeconds must be >0 and <=720')
    if not isinstance(m['provider'].get('argv'), list) or not m['provider']['argv'] or not all(isinstance(x, str) for x in m['provider']['argv']):
        raise ValueError('provider.argv must be a nonempty string list; shell strings are unsupported')
    for collection in ('arms', 'tasks'):
        ids = [x.get('id') for x in m[collection]]
        if not ids or len(ids) != len(set(ids)) or any(not isinstance(x, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', x) for x in ids):
            raise ValueError(f'{collection} require unique safe ids')
    for task in m['tasks']:
        if task.get('family') not in ('repair', 'simplification', 'no-change'):
            raise ValueError('Invalid task family')
        if not isinstance(task.get('prompt'), str) or not task['prompt'].strip():
            raise ValueError('Task prompt required')
        if not task.get('productionRoots') or not task.get('owners'):
            raise ValueError('Production roots and predeclared owners required')
        for root in task['productionRoots']:
            relative(root)
        for owner in task['owners']:
            relative(owner['path'])
            if not isinstance(owner.get('rationale'), str) or not owner['rationale'].strip():
                raise ValueError('Owner rationale required')
        if not task.get('oracle', {}).get('argv'):
            raise ValueError('Trusted oracle argv required')
        for key in ('base',):
            if not Path(task[key]).is_absolute():
                raise ValueError(f'{key} must be absolute')
        output = Path(m['outputRoot']).resolve()
        base = Path(task['base']).resolve()
        if output == base or base in output.parents or output in base.parents:
            raise ValueError('Base and outputRoot must be separate trees')
    return m


def schedule(m):
    rng = random.Random(m['seed'])
    rows = []
    for repeat in range(1, m['repeats'] + 1):
        batch = [{'task': task['id'], 'arm': arm['id'], 'repeat': repeat} for task in m['tasks'] for arm in m['arms']]
        rng.shuffle(batch)
        rows.extend(batch)
    return [dict(row, order=i + 1, id=f"{i + 1:02d}-{row['task']}-{row['arm']}-r{row['repeat']}", seed=rng.randrange(2**32)) for i, row in enumerate(rows)]


def inventory(root):
    root = Path(root)
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d not in IGNORED)
        for name in dirs[:]:
            path = Path(directory) / name
            if path.is_symlink():
                result[path.relative_to(root).as_posix()] = 'symlink:' + os.readlink(path)
                dirs.remove(name)
        for name in sorted(files):
            path = Path(directory) / name
            result[path.relative_to(root).as_posix()] = ('symlink:' + os.readlink(path)) if path.is_symlink() else digest(path.read_bytes())
    return result


def copy_tree(source, target):
    if sys.platform == 'darwin':
        subprocess.run(['cp', '-cR', str(source), str(target)], check=True, capture_output=True)
    else:
        shutil.copytree(source, target, symlinks=True)


def expand(argv, context):
    # Replace supported placeholders in one pass; JSON and code braces are literal.
    pattern = r'\{(workspace|artifacts|output|task|arm|seed|evaluation)\}'
    return [re.sub(pattern, lambda match: str(context.get(match[1], match[0])), arg) for arg in argv]


def process(argv, cwd, timeout, stdout_path, stderr_path, prompt=None):
    started = time.monotonic()
    result = {'argv': argv, 'timeoutSeconds': timeout, 'timedOut': False}
    try:
        with Path(stdout_path).open('w') as out, Path(stderr_path).open('w') as err:
            child = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.PIPE if prompt is not None else subprocess.DEVNULL, stdout=out, stderr=err, text=True, start_new_session=True, env=child_environment())
            try:
                child.communicate(prompt, timeout=timeout)
            except subprocess.TimeoutExpired:
                result['timedOut'] = True
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    pass
                # A terminated leader can leave a SIGTERM-ignoring descendant alive.
                # Escalate the group even when waiting for the leader succeeded.
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                child.wait()
            result['exitCode'] = child.returncode
    except OSError as error:
        result.update(exitCode=None, launchError=f'{type(error).__name__}: {error}')
    result['elapsedSeconds'] = round(time.monotonic() - started, 3)
    result['chargedSeconds'] = max(timeout, result['elapsedSeconds']) if result['timedOut'] or result.get('exitCode') != 0 else result['elapsedSeconds']
    return result


def trace_metrics(path):
    """Codex JSONL adapter; unknown/provider-specific usage stays missing, never zero."""
    usage, commands, errors = {}, [], []
    malformed = 0
    for line in Path(path).read_text(errors='replace').splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            malformed += 1
            continue
        if not isinstance(event, dict):
            malformed += 1
            continue
        if event.get('type') == 'turn.completed' and isinstance(event.get('usage'), dict):
            for key, value in event.get('usage', {}).items():
                if isinstance(value, (int, float)):
                    usage[key] = usage.get(key, 0) + value
        if event.get('type') in ('error', 'turn.failed'):
            errors.append(event)
        item = event.get('item', {})
        if not isinstance(item, dict):
            malformed += 1
            continue
        if event.get('type') == 'item.completed' and item.get('type') == 'command_execution':
            commands.append(item)
    return {'usage': usage or None, 'commandCount': len(commands), 'commands': commands, 'providerErrors': errors, 'malformedTraceLines': malformed}


def protected(path, task):
    return any(fnmatch.fnmatch(path, pattern) for pattern in DEFAULT_PROTECTED + task.get('protectedPaths', []))


def production(path, task):
    return any(path == root or path.startswith(root.rstrip('/') + '/') for root in task['productionRoots']) and not protected(path, task)


def overlay(base, candidate, evaluation, task):
    """Start with trusted source/config/tests; copy only allowed production changes."""
    before, after = inventory(base), inventory(candidate)
    changed = sorted(path for path in before.keys() | after.keys() if before.get(path) != after.get(path))
    accepted, supplemental, rejected = [], [], []
    copy_tree(base, evaluation)
    for path in changed:
        current = after.get(path)
        target = Path(evaluation) / path
        if current and current.startswith('symlink:'):
            rejected.append({'path': path, 'reason': 'candidate symlink'})
        elif production(path, task):
            if target.is_symlink() or any((Path(evaluation) / parent).is_symlink() for parent in Path(path).parents if str(parent) != '.'):
                rejected.append({'path': path, 'reason': 'overlay symlink ancestor'})
                continue
            if current is None:
                target.unlink(missing_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(Path(candidate) / path, target)
            accepted.append(path)
        elif path not in before and (protected(path, task) and ('.test.' in path or '.spec.' in path) or path in ('PILOT_RESULT.md', 'PILOT_FINAL_RESPONSE.md')):
            supplemental.append(path)
        else:
            rejected.append({'path': path, 'reason': 'outside production scope or protected existing input'})
    return {'productionChanges': accepted, 'supplemental': supplemental, 'rejected': rejected, 'changedPaths': changed}


def freeze(m, manifest_path):
    root = Path(m['outputRoot'])
    root.mkdir(parents=True, exist_ok=True)
    if (root / 'freeze.json').exists():
        raise ValueError('Study already frozen; use a new outputRoot')
    inputs = {str(Path(p).resolve()): digest(Path(p).read_bytes()) for p in m.get('protectedInputs', [])}
    frozen = {'schemaVersion': SCHEMA, 'manifestSha256': digest(Path(manifest_path).read_bytes()), 'harnessSha256': digest(Path(__file__).read_bytes()), 'schedule': schedule(m), 'protectedInputs': inputs, 'taskInventories': {t['id']: inventory(t['base']) for t in m['tasks']}, 'owners': {t['id']: t['owners'] for t in m['tasks']}}
    write_json(root / 'freeze.json', frozen)
    write_json(root / 'schedule.json', frozen['schedule'])
    return frozen


def verify_freeze(m, manifest_path):
    frozen = json.loads((Path(m['outputRoot']) / 'freeze.json').read_text())
    if frozen['manifestSha256'] != digest(Path(manifest_path).read_bytes()) or frozen['harnessSha256'] != digest(Path(__file__).read_bytes()):
        raise ValueError('Frozen manifest/harness changed')
    for path, expected in frozen['protectedInputs'].items():
        if digest(Path(path).read_bytes()) != expected:
            raise ValueError(f'Protected evaluator input changed: {path}')
    for task in m['tasks']:
        if inventory(task['base']) != frozen['taskInventories'][task['id']]:
            raise ValueError(f"Frozen task base changed: {task['id']}")
    return frozen


def run_one(m, row, manifest_path=None):
    task = next(t for t in m['tasks'] if t['id'] == row['task'])
    arm = next(a for a in m['arms'] if a['id'] == row['arm'])
    artifacts = Path(m['outputRoot']) / 'runs' / row['id']
    artifacts.mkdir(parents=True, exist_ok=False)
    # Workspaces live outside evaluator artifact trees. Read access is instruction-bounded.
    workspace = Path(tempfile.mkdtemp(prefix='bounded-pilot-')) / 'project'
    metadata = dict(row, workspace=str(workspace), state='preparing', model=m['provider'].get('model'), providerVersion=m['provider'].get('version'), settings=m['provider'].get('settings'), budget=m['budgets'], isolation='Separate workspace; workspace sandbox constrains writes. Read restrictions are instructions plus trace review, not hermetic isolation.')
    write_json(artifacts / 'run.json', metadata)
    try:
        copy_tree(task['base'], workspace)
        context = {'workspace': str(workspace), 'artifacts': str(artifacts), 'output': str(workspace / 'PILOT_FINAL_RESPONSE.md'), 'task': task['id'], 'arm': arm['id'], 'seed': str(row['seed'])}
        prep = []
        for index, hook in enumerate(task.get('prepare', []) + arm.get('prepare', [])):
            result = process(expand(hook, context), workspace, 180, artifacts / f'prepare-{index}.stdout', artifacts / f'prepare-{index}.stderr')
            prep.append(result)
            metadata['preparation'] = prep
            if result.get('exitCode') != 0:
                raise RuntimeError('Preparation failed; inspect retained artifacts')
        prompt = task['prompt'] + '\n\n' + m.get('commonPrompt', '') + '\n\n' + arm.get('promptSuffix', '')
        (artifacts / 'prompt.txt').write_text(prompt)
        metadata.update(preparation=prep, promptSha256=digest(prompt.encode()), state='running')
        write_json(artifacts / 'run.json', metadata)
        result = process(expand(m['provider']['argv'], context), workspace, m['budgets']['timeoutSeconds'], artifacts / 'events.jsonl', artifacts / 'stderr.log', prompt)
        metrics = trace_metrics(artifacts / 'events.jsonl')
        write_json(artifacts / 'commands.json', metrics.pop('commands'))
        metadata.update(provider=result, metrics=metrics, state='candidate-finished')
        evaluation = Path(tempfile.mkdtemp(prefix='protected-pilot-')) / 'source'
        scope = overlay(task['base'], workspace, evaluation, task)
        write_json(artifacts / 'scope.json', scope)
        context['evaluation'] = str(evaluation)
        oracle = process(expand(task['oracle']['argv'], context), evaluation, task['oracle'].get('timeoutSeconds', 120), artifacts / 'oracle.stdout', artifacts / 'oracle.stderr')
        metadata.update(oracle=oracle, evaluation=str(evaluation), scope=scope, protectedChecksPass=oracle.get('exitCode') == 0 and not oracle['timedOut'], state='awaiting-review')
        metadata['accepted'] = None  # Behavioral checks do not replace independent mechanism/scope review.
        if (workspace / 'PILOT_RESULT.md').is_file():
            shutil.copy2(workspace / 'PILOT_RESULT.md', artifacts / 'authored-report.md')
        if (workspace / 'PILOT_FINAL_RESPONSE.md').is_file():
            shutil.copy2(workspace / 'PILOT_FINAL_RESPONSE.md', artifacts / 'result.md')
        archive = artifacts / 'production'
        for path in scope['productionChanges']:
            source = workspace / path
            if source.is_file():
                target = archive / path
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
        write_json(artifacts / 'candidate-inventory.json', inventory(workspace))
        patch_parts = []
        for path in scope['changedPaths']:
            old = Path(task['base']) / path
            new = workspace / path
            old_text = old.read_text(errors='replace').splitlines(keepends=True) if old.is_file() and not old.is_symlink() else []
            new_text = new.read_text(errors='replace').splitlines(keepends=True) if new.is_file() and not new.is_symlink() else []
            patch_parts.extend(difflib.unified_diff(old_text, new_text, fromfile='a/' + path, tofile='b/' + path))
        (artifacts / 'candidate.patch').write_text(''.join(patch_parts))
    except Exception as error:
        metadata.update(state='harness-failed', harnessError=f'{type(error).__name__}: {error}', accepted=False)
    if manifest_path is not None:
        try:
            verify_freeze(m, manifest_path)
            metadata['frozenIntegrity'] = 'verified-after-run'
        except Exception as error:
            metadata.update(state='integrity-failed', accepted=False, frozenIntegrity=f'{type(error).__name__}: {error}')
    write_json(artifacts / 'run.json', metadata)
    return metadata


def charged_run_seconds(run, budget):
    provider = run.get('provider', {})
    observed = provider.get('chargedSeconds', 0)
    failed = (run.get('state') in ('harness-failed', 'integrity-failed')
              or run.get('accepted') is False
              or run.get('protectedChecksPass') is False
              or bool(provider) and (provider.get('exitCode') != 0 or provider.get('timedOut')))
    return max(budget, observed) if failed else observed


def summarize(m):
    rows = schedule(m)
    runs = []
    for row in rows:
        path = Path(m['outputRoot']) / 'runs' / row['id'] / 'run.json'
        runs.append(json.loads(path.read_text()) if path.exists() else dict(row, state='not-run', accepted=None))
    summary = {'assigned': len(rows), 'runs': runs, 'arms': {}}
    for arm in m['arms']:
        group = [r for r in runs if r['arm'] == arm['id']]
        summary['arms'][arm['id']] = {
            'assigned': len(group),
            'accepted': sum(r.get('accepted') is True for r in group),
            'pendingReviewOrRun': sum(r.get('accepted') is None for r in group),
            'timeouts': sum(r.get('provider', {}).get('timedOut', False) for r in group),
            'harnessFailures': sum(r['state'] == 'harness-failed' for r in group),
            'integrityFailures': sum(r['state'] == 'integrity-failed' for r in group),
            'failedBeforeProvider': sum(r['state'] in ('harness-failed', 'integrity-failed') and not r.get('provider') for r in group),
            'chargedSeconds': sum(charged_run_seconds(r, m['budgets']['timeoutSeconds']) for r in group),
            'missingUsage': sum(r.get('metrics', {}).get('usage') is None for r in group),
        }
    write_json(Path(m['outputRoot']) / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'freeze', 'run', 'summarize'])
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--run-id', help='Run one preassigned row; completed rows are never overwritten')
    args = parser.parse_args()
    m = validate_manifest(json.loads(args.manifest.read_text()))
    if args.action == 'validate':
        print(json.dumps({'valid': True, 'assigned': len(schedule(m))}))
    elif args.action == 'freeze':
        freeze(m, args.manifest)
        print('Frozen manifest, harness, owner labels, bases and evaluator inputs.')
    elif args.action == 'run':
        frozen = verify_freeze(m, args.manifest)
        rows = [r for r in frozen['schedule'] if r['id'] == args.run_id] if args.run_id else frozen['schedule']
        if not rows:
            raise ValueError('Unknown run id')
        # Sequential batches preserve the randomized launch order; max two assigned runs overlap.
        for offset in range(0, len(rows), m.get('maxConcurrency', 1)):
            batch = rows[offset:offset + m.get('maxConcurrency', 1)]
            with concurrent.futures.ThreadPoolExecutor(max_workers=len(batch)) as pool:
                futures = [pool.submit(run_one, m, row, args.manifest) for row in batch]
                for future in futures:
                    result = future.result()
                    print(json.dumps({k: result.get(k) for k in ('id', 'state', 'protectedChecksPass', 'harnessError')}), flush=True)
            try:
                verify_freeze(m, args.manifest)
            except Exception as error:
                write_json(Path(m['outputRoot']) / 'integrity-failure.json', {'afterBatch': [r['id'] for r in batch], 'error': str(error)})
                summarize(m)
                raise
            summarize(m)
    else:
        result = summarize(m)
        print(json.dumps({'assigned': result['assigned'], 'arms': result['arms']}, indent=2))


if __name__ == '__main__':
    main()
