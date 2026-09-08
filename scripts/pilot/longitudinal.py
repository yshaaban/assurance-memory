#!/usr/bin/env python3
"""Bounded longitudinal pilots: immutable stage assignments and separate source/knowledge lineages.

No provider runs during validate/freeze/verify/summarize. A run resumes only sealed
outputs; a started but unsealed stage requires explicit abandonment, never a rerun.
Reviews are separate append-only decisions. This is audit integrity, not adversarial
read containment or a claim that generated context has equivalent information.
"""
from __future__ import annotations
import argparse
import concurrent.futures
import difflib
import json
import os
from pathlib import Path
import random
import re
import shutil
import tempfile
import time

import harness as h

SCHEMA = 1
RESERVED = {'PILOT_HANDOFF.md', 'PILOT_RESULT.md', 'PILOT_FINAL_RESPONSE.md'}


def safe_id(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_-]+', value)


def argv(value):
    return isinstance(value, list) and value and all(isinstance(x, str) for x in value)


def within(path, root):
    parts, parent = Path(path).parts, Path(root).parts
    return parts[:len(parent)] == parent


def check_retained_ancestors(root, relative):
    # The supplied root may itself use a platform alias such as macOS /var.
    # Only relative descendants are checked; no retained path may traverse a link.
    current = Path(root)
    for part in Path(relative).parts:
        current /= part
        if current.is_symlink():
            raise ValueError(f'Retained path traverses a symlink: {relative}')


def validate_manifest(m):
    if m.get('schemaVersion') != SCHEMA:
        raise ValueError('Unsupported schemaVersion')
    for key in ('studyId', 'outputRoot', 'provider', 'budgets', 'arms', 'missions', 'seed'):
        if key not in m:
            raise ValueError(f'Missing {key}')
    if not safe_id(m['studyId']) or not isinstance(m['seed'], int) or isinstance(m['seed'], bool):
        raise ValueError('Safe studyId and integer seed required')
    if not Path(m['outputRoot']).is_absolute():
        raise ValueError('outputRoot must be absolute')
    if m.get('maxConcurrency', 1) not in (1, 2):
        raise ValueError('maxConcurrency must be 1 or 2')
    if not argv(m['provider'].get('argv')):
        raise ValueError('provider.argv must be a nonempty string list')
    timeout = m['budgets'].get('timeoutSeconds')
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= 720:
        raise ValueError('timeoutSeconds must be >0 and <=720')
    handoff_limit = m['budgets'].get('handoffMaxBytes', 32_768)
    if isinstance(handoff_limit, bool) or not isinstance(handoff_limit, int) or not 1 <= handoff_limit <= 65_536:
        raise ValueError('handoffMaxBytes must be 1..65536 UTF-8 bytes')
    for collection in ('arms', 'missions'):
        ids = [x.get('id') for x in m[collection]]
        if not ids or len(ids) != len(set(ids)) or not all(safe_id(x) for x in ids):
            raise ValueError(f'{collection} require unique safe ids')
    if len(m['arms']) != 2:
        raise ValueError('Exactly two comparison arms required')
    for arm in m['arms']:
        retained = arm.get('retainedPaths', [])
        for path in retained:
            h.relative(path)
            if Path(path).as_posix() != path or '\\' in path:
                raise ValueError('Retained paths must use canonical relative POSIX spelling')
            if Path(path).parts[0] in h.IGNORED | RESERVED | {'.pilot-context'}:
                raise ValueError('Retained state cannot use ignored or report paths')
        if len(retained) != len(set(retained)) or any(a != b and within(a, b) for a in retained for b in retained):
            raise ValueError('Retained paths must be distinct and nonoverlapping')
    for mission in m['missions']:
        base = Path(mission['base'])
        output = Path(m['outputRoot']).resolve()
        if not base.is_absolute() or output == base.resolve() or output in base.resolve().parents or base.resolve() in output.parents:
            raise ValueError('Absolute base and outputRoot must be separate trees')
        if not mission.get('productionRoots') or not mission.get('owners'):
            raise ValueError('productionRoots and predeclared owners required')
        for root in mission['productionRoots']:
            h.relative(root)
        for owner in mission['owners']:
            h.relative(owner['path'])
            if not owner.get('rationale'):
                raise ValueError('Owner rationale required')
        if not Path(mission['initialKnowledge']).is_absolute():
            raise ValueError('initialKnowledge must be an absolute common plain-text input')
        cycles = mission.get('cycles', [])
        ids = [x.get('id') for x in cycles]
        if not 1 <= len(ids) <= 3 or len(ids) != len(set(ids)) or not all(safe_id(x) for x in ids):
            raise ValueError('Each mission needs one to three unique ordered cycle ids')
        for cycle in cycles:
            if cycle.get('family') not in ('repair', 'simplification', 'no-change') or not cycle.get('prompt', '').strip():
                raise ValueError('Every cycle needs family and prompt')
            if not argv(cycle.get('oracle', {}).get('argv')):
                raise ValueError('Trusted oracle argv required for every cycle')
            oracle_timeout = cycle['oracle'].get('timeoutSeconds', 120)
            if isinstance(oracle_timeout, bool) or not isinstance(oracle_timeout, (int, float)) or not 0 < oracle_timeout <= 720:
                raise ValueError('Oracle timeout must be >0 and <=720')
            for path in cycle.get('knowledgeInputs', []):
                if not Path(path).is_absolute():
                    raise ValueError('knowledgeInputs must be absolute')
            for hook in cycle.get('prepare', []):
                if not argv(hook):
                    raise ValueError('prepare hooks must be argv lists')
        for arm in m['arms']:
            for path in arm.get('retainedPaths', []):
                if any(within(path, root) or within(root, path) for root in mission['productionRoots']):
                    raise ValueError('Retained state and production roots must be disjoint')
    for arm in m['arms']:
        for phase in ('prepare', 'finalize'):
            if not isinstance(arm.get(phase, []), list) or any(not argv(hook) for hook in arm.get(phase, [])):
                raise ValueError(f'{phase} hooks must be argv lists')
    for path in m.get('protectedInputs', []):
        if not Path(path).is_absolute():
            raise ValueError('protectedInputs must be absolute')
    rows = schedule(m)
    if len(rows) != len({row['id'] for row in rows}):
        raise ValueError('Stage ids must be unambiguous across missions and arms')
    if len(rows) > 12:
        raise ValueError('Longitudinal pilot is bounded to at most 12 assigned stages')
    return m


def schedule(m):
    rng, rows = random.Random(m['seed']), []
    for index in range(max(len(x['cycles']) for x in m['missions'])):
        batch = []
        for mission in m['missions']:
            if index < len(mission['cycles']):
                for arm in m['arms']:
                    cycle = mission['cycles'][index]
                    batch.append({'mission': mission['id'], 'arm': arm['id'], 'cycle': cycle['id'], 'cycleIndex': index,
                                  'id': f"{mission['id']}--{arm['id']}--{cycle['id']}",
                                  'predecessor': f"{mission['id']}--{arm['id']}--{mission['cycles'][index - 1]['id']}" if index else None})
        rng.shuffle(batch)
        rows.extend(batch)
    return [dict(row, order=i + 1, seed=rng.randrange(2**32)) for i, row in enumerate(rows)]


def expand(values, context):
    pattern = r'\{(workspace|artifacts|output|task|arm|seed|evaluation|mission|cycle|cycleNumber|base|retained|context)\}'
    return [re.sub(pattern, lambda match: str(context.get(match[1], match[0])), value) for value in values]


def input_paths(m):
    paths = set(m.get('protectedInputs', []))
    paths.update(str(p.resolve()) for p in (Path(__file__), Path(h.__file__)))
    for mission in m['missions']:
        paths.add(mission['initialKnowledge'])
        for cycle in mission['cycles']:
            paths.update(cycle.get('knowledgeInputs', []))
    return sorted(str(Path(p).resolve()) for p in paths)


def write_once(path, value):
    # The exclusive create, rather than a prior exists() check, owns the decision.
    with Path(path).open('x') as output:
        output.write(json.dumps(value, indent=2, sort_keys=True) + '\n')


def freeze(m, manifest):
    root = Path(m['outputRoot'])
    root.mkdir(parents=True, exist_ok=True)
    if any(root.iterdir()):
        raise ValueError('outputRoot must be empty before freeze')
    for mission in m['missions']:
        base = Path(mission['base'])
        if not base.is_dir():
            raise ValueError('Source base must exist before freeze')
        retained = {p for arm in m['arms'] for p in arm.get('retainedPaths', [])}
        for name in retained:
            check_retained_ancestors(base, name)
        reserved = RESERVED | {'.pilot-context'} | retained
        if any((base / name).exists() or (base / name).is_symlink() for name in reserved):
            raise ValueError('Source base contains reserved report/context/retention paths')
    frozen = {'schemaVersion': SCHEMA, 'manifestSha256': h.digest(Path(manifest).read_bytes()),
              'protectedInputs': {p: h.digest(Path(p).read_bytes()) for p in input_paths(m)},
              'missionInventories': {x['id']: h.inventory(x['base']) for x in m['missions']}, 'schedule': schedule(m)}
    write_once(root / 'freeze.json', frozen)
    return frozen


def verify_freeze(m, manifest):
    frozen = json.loads((Path(m['outputRoot']) / 'freeze.json').read_text())
    if frozen['manifestSha256'] != h.digest(Path(manifest).read_bytes()) or frozen['schedule'] != schedule(m):
        raise ValueError('Frozen manifest or schedule changed')
    for path, expected in frozen['protectedInputs'].items():
        if not Path(path).is_file() or h.digest(Path(path).read_bytes()) != expected:
            raise ValueError(f'Protected input changed: {path}')
    for mission in m['missions']:
        if h.inventory(mission['base']) != frozen['missionInventories'][mission['id']]:
            raise ValueError(f"Frozen source changed: {mission['id']}")
    return frozen


def stage_path(m, row):
    return Path(m['outputRoot']) / 'stages' / row['id']


def artifact_inventory(path):
    result = {p: value for p, value in h.inventory(path).items() if p not in ('seal.json', 'review.json')}
    # Source/runtime inventories exclude dependency caches. Retained knowledge has
    # no such exclusion: every byte crossing a cycle is bound to its stage seal.
    retained = path / 'retained-state'
    if not retained.is_symlink():
        result.update({'retained-state/' + p: value for p, value in complete_inventory(retained).items()})
    return result


def complete_inventory(root):
    root = Path(root)
    result = {}
    for directory, dirs, files in os.walk(root, followlinks=False):
        dirs.sort()
        for name in dirs[:]:
            path = Path(directory) / name
            if path.is_symlink():
                result[path.relative_to(root).as_posix()] = 'symlink:' + os.readlink(path)
                dirs.remove(name)
        for name in sorted(files):
            path = Path(directory) / name
            result[path.relative_to(root).as_posix()] = 'symlink:' + os.readlink(path) if path.is_symlink() else h.digest(path.read_bytes())
    return result


def seal(path):
    h.write_json(path / 'seal.json', {'inventory': artifact_inventory(path)})


def verify_stage(m, row):
    path = stage_path(m, row)
    if not (path / 'seal.json').is_file():
        raise ValueError(f"Started stage is incomplete: {row['id']}; abandon explicitly, never rerun")
    expected = json.loads((path / 'seal.json').read_text())['inventory']
    if expected != artifact_inventory(path):
        raise ValueError(f"Sealed stage changed: {row['id']}")
    run = json.loads((path / 'run.json').read_text())
    for key in ('id', 'mission', 'arm', 'cycle', 'cycleIndex', 'predecessor'):
        if run.get(key) != row.get(key):
            raise ValueError('Stage lineage differs from frozen assignment')
    if row['predecessor']:
        previous = next(x for x in schedule(m) if x['id'] == row['predecessor'])
        parent = stage_path(m, previous)
        # Bind source and decision to the exact predecessor bytes, not its mutable name.
        for filename, key in (('seal.json', 'parentSealSha256'), ('review.json', 'parentReviewSha256')):
            if run.get(key) is not None and h.digest((parent / filename).read_bytes()) != run[key]:
                raise ValueError(f'Predecessor {filename} changed')
    return run


def review_stage(m, row, decision):
    run = verify_stage(m, row)
    path = stage_path(m, row)
    if (path / 'review.json').exists():
        raise ValueError('Review already recorded; decisions cannot be replaced')
    required = ('accepted', 'reviewer', 'rationale', 'effortSeconds', 'outcomes')
    if any(key not in decision for key in required) or not isinstance(decision['accepted'], bool):
        raise ValueError('Review requires accepted boolean, reviewer, rationale, effortSeconds, outcomes')
    if not decision['reviewer'] or not decision['rationale'] or not isinstance(decision['outcomes'], dict):
        raise ValueError('Review evidence required')
    effort = decision['effortSeconds']
    if effort is not None and (isinstance(effort, bool) or not isinstance(effort, (float, int)) or effort < 0):
        raise ValueError('effortSeconds must be nonnegative or null for unmetered')
    if decision['accepted'] and (run['state'] != 'awaiting-review' or not run.get('protectedChecksPass') or run.get('scope', {}).get('rejected') or run.get('provider', {}).get('exitCode') != 0 or run.get('provider', {}).get('timedOut')):
        raise ValueError('Failed provider, protected checks, integrity or scope cannot be accepted')
    write_once(path / 'review.json', dict(decision, stageId=row['id'], stageSealSha256=h.digest((path / 'seal.json').read_bytes())))


def read_review(path):
    decision = json.loads((path / 'review.json').read_text())
    if decision['stageSealSha256'] != h.digest((path / 'seal.json').read_bytes()):
        raise ValueError('Review refers to a different stage')
    return decision


def retention_path(path, arm):
    return path in RESERVED or path == '.pilot-context' or path.startswith('.pilot-context/') or any(path == p or path.startswith(p + '/') for p in arm.get('retainedPaths', []))


def copy_retained(source, destination, paths):
    for name in paths:
        check_retained_ancestors(source, name)
        check_retained_ancestors(destination, name)
        origin, target = source / name, destination / name
        if origin.is_symlink():
            raise ValueError('Retained state cannot be a symlink')
        if origin.is_dir():
            if any(value.startswith('symlink:') for value in complete_inventory(origin).values()):
                raise ValueError('Retained state cannot contain symlinks')
            target.parent.mkdir(parents=True, exist_ok=True)
            h.copy_tree(origin, target)
        elif origin.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(origin, target)


def text_input(path):
    # Preserve UTF-8 BOM and line endings; text-mode reads normalize CRLF.
    return Path(path).read_bytes().decode('utf-8')


def handoff_input(path, maximum):
    path = Path(path)
    if not path.exists():
        return ''
    if path.is_symlink() or not path.is_file():
        raise ValueError('Handoff must be a regular file')
    with path.open('rb') as source:
        if os.fstat(source.fileno()).st_size > maximum:
            raise ValueError(f'Handoff exceeds {maximum} UTF-8 bytes; refusing to truncate')
        content = source.read(maximum + 1)
    if len(content) > maximum:
        raise ValueError(f'Handoff exceeds {maximum} UTF-8 bytes; refusing to truncate')
    return content.decode('utf-8')


def finalize_state(arm, context, workspace, artifacts):
    """Export retained state without changing the already captured agent outcome."""
    started = time.monotonic()
    result = {'hooks': [], 'failed': False, 'inventorySeconds': 0.0}
    log_paths = {f'finalize-{i}.{stream}' for i in range(len(arm['finalize'])) for stream in ('stdout', 'stderr')}
    try:
        for name in arm.get('retainedPaths', []):
            check_retained_ancestors(workspace, name)
        inventory_started = time.monotonic()
        before = complete_inventory(workspace)
        before_artifacts = complete_inventory(artifacts)
        result['inventorySeconds'] += time.monotonic() - inventory_started
        for index, hook in enumerate(arm['finalize']):
            try:
                for name in arm.get('retainedPaths', []):
                    check_retained_ancestors(workspace, name)
            except ValueError as error:
                result.update(failed=True, error=str(error))
                break
            outcome = h.process(expand(hook, context), workspace, 180,
                                artifacts / f'finalize-{index}.stdout', artifacts / f'finalize-{index}.stderr')
            result['hooks'].append(outcome)
            if outcome.get('exitCode') != 0 or outcome.get('timedOut'):
                result.update(failed=True, error='Finalization command failed or timed out')
                break
        inventory_started = time.monotonic()
        after = complete_inventory(workspace)
        after_artifacts = {p: v for p, v in complete_inventory(artifacts).items() if p not in log_paths}
        result['inventorySeconds'] += time.monotonic() - inventory_started
        retained_links = sorted(p for p, value in after.items() if value.startswith('symlink:')
                                and any(within(p, root) or within(root, p) for root in arm.get('retainedPaths', [])))
        forbidden = sorted(p for p in before.keys() | after.keys() if before.get(p) != after.get(p)
                           and not any(within(p, root) for root in arm.get('retainedPaths', [])))
        changed_artifacts = sorted(p for p in before_artifacts.keys() | after_artifacts.keys()
                                   if before_artifacts.get(p) != after_artifacts.get(p))
        unexpected_review = (artifacts / 'review.json').exists() or (artifacts / 'review.json').is_symlink()
        if unexpected_review and 'review.json' not in changed_artifacts:
            # Inventories intentionally omit empty directories. The reserved
            # decision path is forbidden regardless of its type or contents.
            changed_artifacts = sorted([*changed_artifacts, 'review.json'])
        result.update(forbiddenWorkspaceChanges=forbidden, changedCapturedArtifacts=changed_artifacts)
        if retained_links:
            result.update(failed=True, error='Finalization produced symlinked retained state', retainedSymlinks=retained_links)
        if forbidden or changed_artifacts:
            result.update(failed=True, error='Finalization changed files outside declared retained state')
        if unexpected_review:
            # An unexpected hook-created decision is evidence of failure, never a
            # review. Preserve it without letting reporting parse it as authority.
            quarantine = Path(tempfile.mkdtemp(prefix='finalization-rejected-', dir=artifacts)) / 'review.json'
            (artifacts / 'review.json').replace(quarantine)
            result['quarantinedReview'] = quarantine.relative_to(artifacts).as_posix()
    except Exception as error:
        result.update(failed=True, error=f'{type(error).__name__}: {error}')
    result['inventorySeconds'] = round(result['inventorySeconds'], 3)
    result['hookSeconds'] = round(sum(hook['elapsedSeconds'] for hook in result['hooks']), 3)
    result['elapsedSeconds'] = round(time.monotonic() - started, 3)
    return result


def blocked_stage(m, row, parent):
    path = stage_path(m, row)
    path.mkdir(parents=True, exist_ok=False)
    run = dict(row, state='blocked-predecessor', accepted=False, parentSealSha256=h.digest((parent / 'seal.json').read_bytes()),
               parentReviewSha256=h.digest((parent / 'review.json').read_bytes()) if (parent / 'review.json').exists() else None)
    h.write_json(path / 'run.json', run)
    seal(path)
    return run


def run_stage(m, row, manifest):
    verify_freeze(m, manifest)
    path = stage_path(m, row)
    if path.exists():
        return verify_stage(m, row)
    mission = next(x for x in m['missions'] if x['id'] == row['mission'])
    arm = next(x for x in m['arms'] if x['id'] == row['arm'])
    cycle = mission['cycles'][row['cycleIndex']]
    parent, parent_run = None, None
    if row['predecessor']:
        previous = next(x for x in schedule(m) if x['id'] == row['predecessor'])
        parent = stage_path(m, previous)
        if not parent.exists():
            return dict(row, state='waiting-predecessor')
        parent_run = verify_stage(m, previous)
        if parent_run['state'] in ('harness-failed', 'integrity-failed', 'abandoned', 'blocked-predecessor'):
            return blocked_stage(m, row, parent)
        if not (parent / 'review.json').exists():
            return dict(row, state='waiting-review')
        if not read_review(parent)['accepted']:
            return blocked_stage(m, row, parent)
    path.mkdir(parents=True, exist_ok=False)
    started = time.monotonic()
    workspace = Path(tempfile.mkdtemp(prefix='longitudinal-candidate-')) / 'project'
    run = dict(row, state='preparing', workspace=str(workspace), accepted=None,
               model=m['provider'].get('model'), providerVersion=m['provider'].get('version'), settings=m['provider'].get('settings'),
               budget=m['budgets'], isolation='Separate workspaces; instructions and trace audit, not hermetic read containment.')
    if parent:
        run.update(parentSealSha256=h.digest((parent / 'seal.json').read_bytes()), parentReviewSha256=h.digest((parent / 'review.json').read_bytes()))
    h.write_json(path / 'run.json', run)
    try:
        source = parent / 'source' if parent else Path(mission['base'])
        source_inventory = h.inventory(source)
        run['inputSourceInventorySha256'] = h.digest(json.dumps(source_inventory, sort_keys=True).encode())
        h.write_json(path / 'input-source-inventory.json', source_inventory)
        for name in arm.get('retainedPaths', []):
            check_retained_ancestors(source, name)
        h.copy_tree(source, workspace)
        for name in arm.get('retainedPaths', []):
            check_retained_ancestors(workspace, name)
        context_dir = workspace / '.pilot-context'
        if context_dir.exists() or any((workspace / name).exists() for name in RESERVED | set(arm.get('retainedPaths', []))):
            raise ValueError('Source snapshot contains reserved pilot paths')
        context_dir.mkdir()
        notes = text_input(mission['initialKnowledge'])
        if parent:
            notes = text_input(parent / 'retained-notes.md')
            copy_retained(parent / 'retained-state', workspace, arm.get('retainedPaths', []))
        for common in cycle.get('knowledgeInputs', []):
            notes += '\n\n' + text_input(common)
        retained = context_dir / 'retained-notes.md'
        retained.write_text(notes)
        delivered = context_dir / 'delivered-context.md'
        delivered.write_text('')
        context = dict(workspace=str(workspace), artifacts=str(path), output=str(workspace / 'PILOT_FINAL_RESPONSE.md'),
                       task=row['mission'], mission=row['mission'], cycle=row['cycle'], cycleNumber=row['cycleIndex'] + 1,
                       base=str(source), arm=row['arm'], seed=row['seed'],
                       retained=str(retained), context=str(delivered))
        preparation = []
        for index, hook in enumerate(cycle.get('prepare', []) + arm.get('prepare', [])):
            for name in arm.get('retainedPaths', []):
                check_retained_ancestors(workspace, name)
            result = h.process(expand(hook, context), workspace, 180, path / f'prepare-{index}.stdout', path / f'prepare-{index}.stderr')
            preparation.append(result)
            run['preparation'] = preparation
            if result.get('exitCode') != 0:
                raise ValueError('Preparation failed')
        for name in arm.get('retainedPaths', []):
            check_retained_ancestors(workspace, name)
        if text_input(retained) != notes:
            raise ValueError('Preparation changed canonical retained knowledge')
        after_prepare = h.inventory(workspace)
        if {p: v for p, v in after_prepare.items() if not retention_path(p, arm)} != source_inventory:
            raise ValueError('Preparation changed source or protected inputs')
        h.write_json(path / 'prepared-workspace-inventory.json', after_prepare)
        (path / 'input-notes.md').write_text(notes)
        (path / 'delivered-context.md').write_text(text_input(delivered))
        handoff_limit = m['budgets'].get('handoffMaxBytes', 32_768)
        prompt = '\n\n'.join([cycle['prompt'], m.get('commonPrompt', ''), arm.get('promptSuffix', ''),
                              'Canonical retained notes for this change cycle:\n' + notes,
                              'Additional task context:\n' + text_input(delivered),
                              f'Write reusable findings, rejected hypotheses, counterevidence and remaining uncertainty to PILOT_HANDOFF.md, within {handoff_limit} UTF-8 bytes. Oversized handoffs fail the stage without truncation. Preserve evidence boundaries and distinguish current observations from earlier claims.'])
        (path / 'prompt.txt').write_text(prompt)
        run.update(state='running', promptSha256=h.digest(prompt.encode()))
        h.write_json(path / 'run.json', run)
        run['provider'] = h.process(expand(m['provider']['argv'], context), workspace, m['budgets']['timeoutSeconds'], path / 'events.jsonl', path / 'stderr.log', prompt)
        metrics = h.trace_metrics(path / 'events.jsonl')
        h.write_json(path / 'commands.json', metrics.pop('commands'))
        run['metrics'] = metrics
        # Both treatment state and reports are archived separately from allowed source.
        new_notes = handoff_input(workspace / 'PILOT_HANDOFF.md', handoff_limit)
        candidate_inventory = h.inventory(workspace)
        for name in ('PILOT_HANDOFF.md', 'PILOT_RESULT.md', 'PILOT_FINAL_RESPONSE.md'):
            report = workspace / name
            if report.is_symlink():
                raise ValueError('Reports cannot be symlinks')
            if report.is_file():
                shutil.copy2(report, path / name)
        (path / 'retained-notes.md').write_text(notes + f"\n\n## Retained from cycle {row['cycle']}\n" + new_notes)
        run['knowledgeWritten'] = bool(new_notes.strip())
        # Remove experiment-only paths from a disposable overlay view, never the candidate.
        overlay_view = Path(tempfile.mkdtemp(prefix='longitudinal-overlay-')) / 'project'
        h.copy_tree(workspace, overlay_view)
        for name in list(RESERVED) + ['.pilot-context'] + arm.get('retainedPaths', []):
            if name in arm.get('retainedPaths', []):
                check_retained_ancestors(overlay_view, name)
            target = overlay_view / name
            if target.is_dir() and not target.is_symlink():
                shutil.rmtree(target)
            else:
                target.unlink(missing_ok=True)
        evaluation = Path(tempfile.mkdtemp(prefix='longitudinal-oracle-')) / 'project'
        run['evaluation'] = str(evaluation)
        scope = h.overlay(source, overlay_view, evaluation, mission)
        patch = []
        for name in scope['changedPaths']:
            old, new = source / name, overlay_view / name
            before = old.read_text(errors='replace').splitlines(keepends=True) if old.is_file() and not old.is_symlink() else []
            after = new.read_text(errors='replace').splitlines(keepends=True) if new.is_file() and not new.is_symlink() else []
            patch.extend(difflib.unified_diff(before, after, fromfile='a/' + name, tofile='b/' + name))
        (path / 'candidate.patch').write_text(''.join(patch))
        shutil.rmtree(overlay_view.parent)
        run['scope'] = scope
        # The next cycle receives this pre-oracle source, never evaluator-created files.
        h.copy_tree(evaluation, path / 'source')
        expected_evaluation = h.inventory(evaluation)
        context['evaluation'] = str(evaluation)
        run['oracle'] = h.process(expand(cycle['oracle']['argv'], context), evaluation, cycle['oracle'].get('timeoutSeconds', 120), path / 'oracle.stdout', path / 'oracle.stderr')
        observed = h.inventory(evaluation)
        changed_existing = [p for p, value in expected_evaluation.items() if observed.get(p) != value]
        changed_production = [p for p in observed.keys() | expected_evaluation.keys() if h.production(p, mission) and observed.get(p) != expected_evaluation.get(p)]
        if changed_existing or changed_production:
            raise ValueError('Protected evaluation mutated source or existing trusted files')
        run.update(evaluation=str(evaluation), protectedChecksPass=run['oracle'].get('exitCode') == 0 and not run['oracle']['timedOut'], state='awaiting-review')
        h.write_json(path / 'candidate-inventory.json', candidate_inventory)
        h.write_json(path / 'scope.json', scope)
        if arm.get('finalize'):
            if run['provider'].get('exitCode') == 0 and not run['provider'].get('timedOut'):
                run['finalization'] = finalize_state(arm, context, workspace, path)
                if run['finalization']['failed']:
                    run.update(state='harness-failed', accepted=False, harnessError=run['finalization']['error'])
            else:
                run['finalization'] = {'skipped': 'PROVIDER_FAILURE', 'hooks': [], 'failed': False,
                                       'elapsedSeconds': 0.0, 'hookSeconds': 0.0, 'inventorySeconds': 0.0}
        capture = path / 'retained-state'
        if capture.exists() or capture.is_symlink():
            raise ValueError('Retained-state capture destination must be absent')
        copy_retained(workspace, capture, arm.get('retainedPaths', []))
        if h.inventory(source) != source_inventory:
            raise ValueError('Stage input source changed during execution')
    except Exception as error:
        run.update(state='harness-failed', accepted=False, harnessError=f'{type(error).__name__}: {error}')
    try:
        verify_freeze(m, manifest)
        if parent:
            verify_stage(m, previous)
        run['frozenIntegrity'] = 'verified-after-stage'
    except Exception as error:
        run.update(state='integrity-failed', accepted=False, frozenIntegrity=str(error))
    run['orchestrationSeconds'] = round(time.monotonic() - started, 3)
    h.write_json(path / 'run.json', run)
    seal(path)
    return run


def abandon_stage(m, row, reason):
    path = stage_path(m, row)
    if not reason.strip() or not path.exists() or (path / 'seal.json').exists():
        raise ValueError('Only an existing incomplete stage can be abandoned, with a reason')
    run = json.loads((path / 'run.json').read_text())
    run.update(state='abandoned', accepted=False, abandonmentReason=reason)
    h.write_json(path / 'run.json', run)
    seal(path)
    return run


def summarize(m):
    runs = []
    for row in schedule(m):
        path = stage_path(m, row)
        if not path.exists():
            run = dict(row, state='not-run', accepted=None)
        elif not (path / 'seal.json').exists():
            run = dict(row, state='incomplete', accepted=False)
        else:
            run = verify_stage(m, row)
            if (path / 'review.json').exists():
                run['review'] = read_review(path)
                run['accepted'] = run['review']['accepted']
        runs.append(run)
    summary = {'assigned': len(runs), 'runs': runs, 'arms': {}}
    for arm in m['arms']:
        group = [x for x in runs if x['arm'] == arm['id']]
        summary['arms'][arm['id']] = {
            'assigned': len(group), 'accepted': sum(x.get('accepted') is True for x in group),
            'pending': sum(x.get('accepted') is None for x in group),
            'blocked': sum(x['state'] == 'blocked-predecessor' for x in group),
            'incomplete': sum(x['state'] == 'incomplete' for x in group),
            'providerStages': sum('provider' in x for x in group),
            'providerFailures': sum(bool(x.get('provider')) and (x['provider'].get('exitCode') != 0 or x['provider'].get('timedOut')) for x in group),
            'protectedCheckFailures': sum(x.get('protectedChecksPass') is False for x in group),
            'harnessFailures': sum(x['state'] in ('harness-failed', 'abandoned') for x in group),
            'integrityFailures': sum(x['state'] == 'integrity-failed' for x in group),
            'finalizationFailures': sum(x.get('finalization', {}).get('failed', False) for x in group),
            'finalizationSkipped': sum(bool(x.get('finalization', {}).get('skipped')) for x in group),
            'providerElapsedSeconds': sum(x.get('provider', {}).get('elapsedSeconds', 0) for x in group),
            'chargedSeconds': sum(h.charged_run_seconds(x, m['budgets']['timeoutSeconds']) for x in group),
            'preparationSeconds': sum(p['elapsedSeconds'] for x in group for p in x.get('preparation', [])),
            'finalizationSeconds': sum(x.get('finalization', {}).get('elapsedSeconds', 0) for x in group),
            'finalizationHookSeconds': sum(x.get('finalization', {}).get('hookSeconds', 0) for x in group),
            'finalizationInventorySeconds': sum(x.get('finalization', {}).get('inventorySeconds', 0) for x in group),
            'orchestrationSeconds': sum(x.get('orchestrationSeconds', 0) for x in group),
            'reviewSeconds': sum(x.get('review', {}).get('effortSeconds') or 0 for x in group),
            'unmeteredReviews': sum('review' in x and x['review']['effortSeconds'] is None for x in group),
            'missingUsage': sum(x.get('metrics', {}).get('usage') is None for x in group)}
    h.write_json(Path(m['outputRoot']) / 'summary.json', summary)
    return summary


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['validate', 'freeze', 'verify', 'run', 'review', 'abandon', 'summarize'])
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--stage-id')
    parser.add_argument('--decision', type=Path)
    parser.add_argument('--reason')
    args = parser.parse_args()
    m = validate_manifest(json.loads(args.manifest.read_text()))
    if args.action == 'validate':
        print(json.dumps({'valid': True, 'assigned': len(schedule(m))}))
        return
    if args.action == 'freeze':
        freeze(m, args.manifest)
        print('Frozen longitudinal assignments, source, common knowledge and evaluator inputs.')
        return
    verify_freeze(m, args.manifest)
    rows = [r for r in schedule(m) if not args.stage_id or r['id'] == args.stage_id]
    if not rows:
        raise ValueError('Unknown assigned stage')
    if args.action in ('review', 'abandon'):
        if not args.stage_id:
            raise ValueError('--stage-id required')
        if args.action == 'review':
            if not args.decision:
                raise ValueError('--decision required')
            review_stage(m, rows[0], json.loads(args.decision.read_text()))
        else:
            abandon_stage(m, rows[0], args.reason or '')
    elif args.action == 'run':
        # Cycle barriers preserve seeded order while preventing predecessor races.
        for cycle_index in sorted({x['cycleIndex'] for x in rows}):
            cycle_rows = [r for r in rows if r['cycleIndex'] == cycle_index]
            for offset in range(0, len(cycle_rows), m.get('maxConcurrency', 1)):
                batch = cycle_rows[offset:offset + m.get('maxConcurrency', 1)]
                with concurrent.futures.ThreadPoolExecutor(max_workers=len(batch)) as pool:
                    for result in pool.map(lambda row: run_stage(m, row, args.manifest), batch):
                        print(json.dumps({k: result.get(k) for k in ('id', 'state', 'protectedChecksPass', 'harnessError')}), flush=True)
                verify_freeze(m, args.manifest)
                summarize(m)
    result = summarize(m)
    print(json.dumps({'assigned': result['assigned'], 'arms': result['arms']}, indent=2))


if __name__ == '__main__':
    main()
