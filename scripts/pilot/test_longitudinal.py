import copy
import concurrent.futures
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from threading import Barrier

sys.path.insert(0, str(Path(__file__).parent))
import harness as h
import longitudinal as l


class LongitudinalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.workspaces = []
        base = self.root / 'base'
        (base / 'src').mkdir(parents=True)
        (base / 'src/value.py').write_text('0')
        (base / 'src/value.test.py').write_text('trusted test')
        (self.root / 'initial.md').write_text('Common initial uncertainty; no solution supplied.')
        self.provider = self.root / 'provider.py'
        self.provider.write_text('''import json,sys
from pathlib import Path
root=Path(sys.argv[1]); cycle=int(sys.argv[2]); arm=sys.argv[3]
(root/'src/value.py').write_text(str(int((root/'src/value.py').read_text())+1))
(root/'PILOT_HANDOFF.md').write_text(f'Observed cycle {cycle} in arm {arm}; previous hypothesis remains uncertain.')
(root/'PILOT_RESULT.md').write_text('Detailed mechanism report')
Path(sys.argv[4]).write_text('Final response')
state=root/'.memory'
state.mkdir(exist_ok=True)
(state/'observations.txt').write_text((state/'observations.txt').read_text()+'x' if (state/'observations.txt').exists() else 'x')
print(json.dumps({'type':'turn.completed','usage':{'input_tokens':10,'output_tokens':3}}))
''')
        oracle = [sys.executable, '-c', 'from pathlib import Path; import sys; assert Path("src/value.py").read_text()==sys.argv[1]; assert Path("src/value.test.py").read_text()=="trusted test"', '{cycleNumber}']
        self.m = {'schemaVersion': 1, 'studyId': 'longitudinal-test', 'seed': 941,
                  'outputRoot': str(self.root / 'results'), 'maxConcurrency': 2,
                  'provider': {'argv': [sys.executable, str(self.provider), '{workspace}', '{cycleNumber}', '{arm}', '{output}']},
                  'budgets': {'timeoutSeconds': 10}, 'protectedInputs': [str(self.provider)],
                  'arms': [{'id': 'A', 'retainedPaths': ['.memory']}, {'id': 'B', 'retainedPaths': ['.memory']}],
                  'missions': [{'id': 'one', 'base': str(base), 'initialKnowledge': str(self.root / 'initial.md'),
                                'productionRoots': ['src'], 'owners': [{'path': 'src/value.py', 'rationale': 'Owns value behavior.'}],
                                'cycles': [{'id': str(i), 'family': 'repair', 'prompt': f'Implement change cycle {i}.', 'oracle': {'argv': oracle}} for i in range(1, 4)]}]}
        self.manifest = self.root / 'manifest.json'

    def tearDown(self):
        for path in self.workspaces:
            shutil.rmtree(path, ignore_errors=True)
        self.temp.cleanup()

    def freeze(self):
        l.validate_manifest(self.m)
        self.manifest.write_text(json.dumps(self.m))
        l.freeze(self.m, self.manifest)

    def row(self, arm='A', cycle=1, mission='one'):
        return next(r for r in l.schedule(self.m) if r['arm'] == arm and r['cycleIndex'] == cycle - 1 and r['mission'] == mission)

    def run_stage(self, arm='A', cycle=1):
        run = l.run_stage(self.m, self.row(arm, cycle), self.manifest)
        for key in ('workspace', 'evaluation'):
            if run.get(key):
                self.workspaces.append(Path(run[key]).parent)
        return run

    def review(self, arm='A', cycle=1, accepted=True):
        l.review_stage(self.m, self.row(arm, cycle), {'accepted': accepted, 'reviewer': 'independent-test-reviewer',
                       'rationale': 'Behavior and source scope independently inspected.', 'effortSeconds': 2,
                       'outcomes': {'missedImpacts': 0, 'staleReasoningErrors': 0}})

    def test_schedule_has_12_assignments_and_separate_predecessors_without_repeats(self):
        second = copy.deepcopy(self.m['missions'][0])
        second['id'] = 'two'
        self.m['missions'].append(second)
        l.validate_manifest(self.m)
        rows = l.schedule(self.m)
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows, l.schedule(self.m))
        for row in rows:
            if row['predecessor']:
                parent = next(x for x in rows if x['id'] == row['predecessor'])
                self.assertEqual((parent['mission'], parent['arm']), (row['mission'], row['arm']))
                self.assertLess(parent['order'], row['order'])
                self.assertEqual(parent['cycleIndex'] + 1, row['cycleIndex'])

    def test_three_cycles_carry_approved_source_notes_and_state_without_crossing_arms(self):
        self.freeze()
        for cycle in range(1, 4):
            run = self.run_stage(cycle=cycle)
            self.assertEqual(run['state'], 'awaiting-review', run)
            self.assertTrue(run['protectedChecksPass'])
            self.assertEqual(run['scope']['productionChanges'], ['src/value.py'])
            path = l.stage_path(self.m, self.row(cycle=cycle))
            self.assertEqual((path / 'source/src/value.py').read_text(), str(cycle))
            self.assertEqual((path / 'retained-state/.memory/observations.txt').read_text(), 'x' * cycle)
            self.assertEqual((path / 'PILOT_RESULT.md').read_text(), 'Detailed mechanism report')
            self.assertEqual((path / 'PILOT_FINAL_RESPONSE.md').read_text(), 'Final response')
            notes = (path / 'retained-notes.md').read_text()
            for previous in range(1, cycle + 1):
                self.assertIn(f'Observed cycle {previous} in arm A', notes)
            self.review(cycle=cycle)
        other = self.run_stage(arm='B')
        self.assertTrue(other['protectedChecksPass'])
        peer = l.stage_path(self.m, self.row('B'))
        self.assertNotIn('in arm A', (peer / 'prompt.txt').read_text())
        self.assertEqual((peer / 'source/src/value.py').read_text(), '1')
        self.assertEqual((self.root / 'base/src/value.py').read_text(), '0')
        summary = l.summarize(self.m)
        self.assertEqual(summary['assigned'], 6)
        self.assertEqual(summary['arms']['A']['accepted'], 3)
        self.assertEqual(summary['arms']['A']['reviewSeconds'], 6)

    def test_finalization_exports_replacement_archive_before_capture_across_three_cycles(self):
        dependencies = self.root / 'base/node_modules'
        (dependencies / '.bin').mkdir(parents=True)
        (dependencies / 'fixture-tool').mkdir()
        (dependencies / 'fixture-tool/cli.js').write_text('/* Installed fixture executable. */')
        (dependencies / '.bin/fixture-tool').symlink_to('../fixture-tool/cli.js')
        prepare = ('import json; from pathlib import Path; p=Path(".memory/archive.json"); '
                   'Path(".pilot-context/restored.json").write_text(p.read_text() if p.exists() else "null")')
        finalize = ('import json; from pathlib import Path; '
                    'temporary=Path(".memory/archive.tmp"); '
                    'temporary.open("x").write(json.dumps({"value": int(Path("src/value.py").read_text())})); '
                    'temporary.replace(Path(".memory/archive.json"))')
        self.m['arms'][0].update(prepare=[[sys.executable, '-c', prepare]], finalize=[[sys.executable, '-c', finalize]])
        self.provider.write_text(self.provider.read_text() + '\nif cycle > 1: assert json.loads((root/".pilot-context/restored.json").read_text())["value"] == cycle-1\n')
        self.freeze()
        for cycle in range(1, 4):
            run = self.run_stage(cycle=cycle)
            self.assertEqual(run['state'], 'awaiting-review', run)
            self.assertFalse(run['finalization']['failed'])
            self.assertEqual(len(run['finalization']['hooks']), 1)
            self.assertGreater(run['finalization']['hookSeconds'], 0)
            self.assertGreaterEqual(run['finalization']['elapsedSeconds'], run['finalization']['inventorySeconds'])
            path = l.stage_path(self.m, self.row(cycle=cycle))
            self.assertEqual(json.loads((path / 'retained-state/.memory/archive.json').read_text()), {'value': cycle})
            self.assertFalse((path / 'retained-state/.memory/archive.tmp').exists())
            self.assertTrue((Path(run['workspace']) / 'node_modules/.bin/fixture-tool').is_symlink())
            self.review(cycle=cycle)
        summary = l.summarize(self.m)['arms']['A']
        self.assertEqual(summary['accepted'], 3)
        self.assertEqual(summary['finalizationFailures'], 0)
        self.assertGreater(summary['finalizationHookSeconds'], 0)

    def test_supplemental_tests_retain_revisions_and_deletions_without_becoming_oracle_inputs(self):
        self.m['retainSupplementalTests'] = True
        self.provider.write_text(self.provider.read_text() + '''
test=root/'src/authored.test.py'
if cycle == 1:
    assert not test.exists()
    test.write_text('untrusted '+arm+' 1')
else:
    assert test.read_text() == 'untrusted '+arm+' '+str(cycle-1)
    if cycle == 2: test.write_text('untrusted '+arm+' 2')
    else: test.unlink()
''')
        for cycle in self.m['missions'][0]['cycles']:
            cycle['oracle']['argv'][2] += '; assert not Path("src/authored.test.py").exists()'
        self.freeze()
        for cycle in range(1, 4):
            for arm in ['A', 'B']:
                run = self.run_stage(arm, cycle)
                self.assertEqual(run['state'], 'awaiting-review', run)
                self.assertTrue(run['protectedChecksPass'])
                path = l.stage_path(self.m, self.row(arm, cycle))
                self.assertFalse((path / 'source/src/authored.test.py').exists())
                self.assertIn('untrusted authored verification artifacts', (path / 'prompt.txt').read_text())
                self.assertFalse(run['supplementalTests']['includedInProtectedOracle'])
                capture = path / 'supplemental-tests/src/authored.test.py'
                if cycle < 3:
                    self.assertEqual(capture.read_text(), f'untrusted {arm} {cycle}')
                else:
                    self.assertFalse(capture.exists())
                self.review(arm, cycle)
        first = l.stage_path(self.m, self.row('A', 1))
        self.assertEqual((first / 'supplemental-tests/src/authored.test.py').read_text(), 'untrusted A 1')
        for row in l.schedule(self.m):
            l.verify_stage(self.m, row)

    def test_supplemental_test_retention_is_common_explicit_and_disabled_by_default(self):
        self.provider.write_text(self.provider.read_text() + '\n(root/"src/authored.test.py").write_text("new")\n')
        self.freeze()
        run = self.run_stage()
        self.assertTrue(run['protectedChecksPass'])
        self.assertNotIn('supplementalTests', run)
        self.assertFalse((l.stage_path(self.m, self.row()) / 'supplemental-tests').exists())
        for invalid in [1, 'true', None]:
            changed = copy.deepcopy(self.m)
            changed['retainSupplementalTests'] = invalid
            with self.assertRaisesRegex(ValueError, 'common boolean'):
                l.validate_manifest(changed)
        self.m['arms'][0]['retainSupplementalTests'] = True
        with self.assertRaisesRegex(ValueError, 'common to both arms'):
            l.validate_manifest(self.m)

    def test_preparation_cannot_rewrite_carried_agent_tests(self):
        self.m['retainSupplementalTests'] = True
        self.provider.write_text(self.provider.read_text() + '\n(root/"src/authored.test.py").write_text("agent evidence")\n')
        self.m['missions'][0]['cycles'][1]['prepare'] = [[sys.executable, '-c',
            'from pathlib import Path; Path("src/authored.test.py").write_text("evaluator laundering")']]
        self.freeze()
        self.assertTrue(self.run_stage()['protectedChecksPass'])
        self.review()
        run = self.run_stage(cycle=2)
        self.assertEqual(run['state'], 'harness-failed')
        self.assertIn('Preparation changed source or protected inputs', run['harnessError'])
        self.assertNotIn('provider', run)

    def test_carried_tests_reject_trusted_reserved_and_symlink_collisions(self):
        self.m['retainSupplementalTests'] = True
        mission = self.m['missions'][0]
        source = Path(mission['base'])
        parent = self.root / 'parent'
        tests = parent / 'supplemental-tests'
        workspace = self.root / 'candidate'
        h.copy_tree(source, workspace)
        for name in ['src/value.test.py', '.pilot-context/tool.test.py', '.memory/tool.test.py']:
            with self.subTest(name=name):
                shutil.rmtree(tests, ignore_errors=True)
                target = tests / name
                target.parent.mkdir(parents=True)
                target.write_text('untrusted overwrite')
                with self.assertRaisesRegex(ValueError, 'collides'):
                    l.restore_supplemental_tests(parent, workspace, h.inventory(source), mission, self.m)
        shutil.rmtree(tests)
        tests.mkdir()
        (tests / 'src').symlink_to(source / 'src', target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'collides'):
            l.restore_supplemental_tests(parent, workspace, h.inventory(source), mission, self.m)
        self.assertEqual((source / 'src/value.test.py').read_text(), 'trusted test')

    def test_finalization_failure_keeps_provider_checks_and_failure_denominator_separate(self):
        self.m['arms'][0]['finalize'] = [[sys.executable, '-c', 'import sys; sys.exit(7)']]
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['state'], 'harness-failed')
        self.assertEqual(run['provider']['exitCode'], 0)
        self.assertTrue(run['protectedChecksPass'])
        self.assertTrue(run['finalization']['failed'])
        self.assertEqual(run['finalization']['hooks'][0]['exitCode'], 7)
        path = l.stage_path(self.m, self.row())
        self.assertEqual((path / 'source/src/value.py').read_text(), '1')
        self.assertEqual((path / 'PILOT_RESULT.md').read_text(), 'Detailed mechanism report')
        self.assertEqual(self.run_stage(cycle=2)['state'], 'blocked-predecessor')
        self.assertEqual(self.run_stage(cycle=3)['state'], 'blocked-predecessor')
        summary = l.summarize(self.m)['arms']['A']
        self.assertEqual(summary['assigned'], 3)
        self.assertEqual(summary['blocked'], 2)
        self.assertEqual(summary['finalizationFailures'], 1)
        self.assertEqual(summary['harnessFailures'], 1)
        self.assertEqual(summary['providerFailures'], 0)
        self.assertEqual(summary['protectedCheckFailures'], 0)
        self.assertEqual(summary['chargedSeconds'], 30)
        with self.assertRaises(ValueError):
            self.review()

    def test_finalization_cannot_repair_source_tests_reports_context_or_ignored_runtime(self):
        targets = ['src/value.py', 'src/value.test.py', 'PILOT_HANDOFF.md', 'PILOT_RESULT.md',
                   'PILOT_FINAL_RESPONSE.md', '.pilot-context/retained-notes.md',
                   '.pilot-context/delivered-context.md', '.pilot-tools/runtime.js']
        for index, target in enumerate(targets):
            with self.subTest(target=target):
                self.m['outputRoot'] = str(self.root / f'forbidden-{index}')
                self.manifest = self.root / f'forbidden-manifest-{index}.json'
                self.m['arms'][0]['finalize'] = [[sys.executable, '-c',
                    'from pathlib import Path; import sys; p=Path(sys.argv[1]); p.parent.mkdir(parents=True,exist_ok=True); p.write_text("evaluator replacement")', target]]
                self.freeze()
                run = self.run_stage()
                self.assertEqual(run['state'], 'harness-failed', run)
                self.assertTrue(run['protectedChecksPass'])
                self.assertEqual(run['provider']['exitCode'], 0)
                self.assertEqual(run['finalization']['forbiddenWorkspaceChanges'], [target])
                path = l.stage_path(self.m, self.row())
                self.assertEqual((path / 'source/src/value.py').read_text(), '1')
                self.assertEqual((path / 'PILOT_RESULT.md').read_text(), 'Detailed mechanism report')

    def test_finalization_cannot_rewrite_captured_artifact_or_install_a_review(self):
        cases = {'file': 'p.write_text("forged review")', 'empty-directory': 'p.mkdir()',
                 'directory': 'p.mkdir(); (p/"data.txt").write_text("forged review")',
                 'symlink': 'p.symlink_to("absent-review-target")'}
        for kind, action in cases.items():
            with self.subTest(kind=kind):
                self.m['outputRoot'] = str(self.root / f'review-{kind}')
                self.manifest = self.root / f'review-manifest-{kind}.json'
                self.m['arms'][0]['finalize'] = [[sys.executable, '-c',
                    'from pathlib import Path; import sys; p=Path(sys.argv[1],"review.json"); ' + action, '{artifacts}']]
                self.freeze()
                run = self.run_stage()
                self.assertEqual(run['state'], 'harness-failed')
                self.assertIn('review.json', run['finalization']['changedCapturedArtifacts'])
                self.assertTrue(run['protectedChecksPass'])
                artifacts = l.stage_path(self.m, self.row())
                self.assertFalse((artifacts / 'review.json').exists())
                self.assertFalse((artifacts / 'review.json').is_symlink())
                quarantined = artifacts / run['finalization']['quarantinedReview']
                if kind == 'file':
                    self.assertEqual(quarantined.read_text(), 'forged review')
                elif kind == 'directory':
                    self.assertEqual((quarantined / 'data.txt').read_text(), 'forged review')
                elif kind == 'empty-directory':
                    self.assertTrue(quarantined.is_dir())
                    self.assertEqual(list(quarantined.iterdir()), [])
                else:
                    self.assertTrue(quarantined.is_symlink())
                    self.assertEqual(str(quarantined.readlink()), 'absent-review-target')
                self.assertEqual(l.summarize(self.m)['arms']['A']['finalizationFailures'], 1)
                self.review(accepted=False)
                self.assertEqual(self.run_stage(cycle=2)['state'], 'blocked-predecessor')
                self.assertEqual(self.run_stage(cycle=3)['state'], 'blocked-predecessor')
                summary = l.summarize(self.m)['arms']['A']
                self.assertEqual(summary['assigned'], 3)
                self.assertEqual(summary['blocked'], 2)
                self.assertEqual(summary['chargedSeconds'], 30)

    def test_finalization_rejects_captured_dependency_or_tool_mutation(self):
        for name in ['node_modules', '.pilot-tools']:
            with self.subTest(name=name):
                runtime = self.root / 'base' / name / 'runtime.js'
                runtime.parent.mkdir(exist_ok=True)
                runtime.write_text('trusted runtime')
                self.m['outputRoot'] = str(self.root / f'runtime-{name}')
                self.manifest = self.root / f'runtime-manifest-{name}.json'
                self.m['arms'][0]['finalize'] = [[sys.executable, '-c',
                    'from pathlib import Path; import sys; Path(sys.argv[1]).write_text("captured runtime corruption")',
                    '{artifacts}/source/' + name + '/runtime.js']]
                self.freeze()
                run = self.run_stage()
                self.assertEqual(run['state'], 'harness-failed')
                self.assertEqual(run['finalization']['changedCapturedArtifacts'], [f'source/{name}/runtime.js'])
                self.assertEqual(run['provider']['exitCode'], 0)
                self.assertTrue(run['protectedChecksPass'])
                self.assertEqual((Path(run['workspace']) / name / 'runtime.js').read_text(), 'trusted runtime')
                self.assertEqual(self.run_stage(cycle=2)['state'], 'blocked-predecessor')
                self.assertEqual(self.run_stage(cycle=3)['state'], 'blocked-predecessor')
                summary = l.summarize(self.m)['arms']['A']
                self.assertEqual(summary['finalizationFailures'], 1)
                self.assertEqual(summary['providerFailures'], 0)
                self.assertEqual(summary['protectedCheckFailures'], 0)
                self.assertEqual(summary['blocked'], 2)

    def test_finalization_cannot_redirect_the_new_retained_capture_root(self):
        external = self.root / 'external-capture'
        external.mkdir()
        sentinel = external / 'sentinel.txt'
        sentinel.write_text('keep external data')
        self.m['arms'][0]['finalize'] = [[sys.executable, '-c',
            'from pathlib import Path; import sys; Path(sys.argv[1],"retained-state").symlink_to(sys.argv[2],target_is_directory=True)',
            '{artifacts}', str(external)]]
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['state'], 'harness-failed')
        self.assertTrue(run['finalization']['failed'])
        self.assertIn('capture destination must be absent', run['harnessError'])
        self.assertTrue(run['protectedChecksPass'])
        self.assertEqual(sentinel.read_text(), 'keep external data')
        self.assertFalse((external / '.memory').exists())
        # The failed-stage seal records the link text, not an external tree read.
        sentinel.write_text('independent external change')
        l.verify_stage(self.m, self.row())
        self.assertEqual(l.summarize(self.m)['arms']['A']['finalizationFailures'], 1)
        self.assertEqual(self.run_stage(cycle=2)['state'], 'blocked-predecessor')

    def test_failed_provider_does_not_run_finalization_or_become_an_export_failure(self):
        self.provider.write_text(self.provider.read_text() + '\nraise SystemExit(9)\n')
        self.m['arms'][0]['finalize'] = [[sys.executable, '-c', 'raise RuntimeError("must not run")']]
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['provider']['exitCode'], 9)
        self.assertEqual(run['finalization']['skipped'], 'PROVIDER_FAILURE')
        self.assertFalse(run['finalization']['failed'])
        self.assertEqual(run['finalization']['hooks'], [])
        summary = l.summarize(self.m)['arms']['A']
        self.assertEqual(summary['providerFailures'], 1)
        self.assertEqual(summary['finalizationFailures'], 0)
        self.assertEqual(summary['finalizationSkipped'], 1)

    def test_stage_waits_for_review_and_rejection_blocks_all_descendants_in_denominator(self):
        self.freeze()
        self.run_stage()
        self.assertEqual(self.run_stage(cycle=2)['state'], 'waiting-review')
        self.assertFalse(l.stage_path(self.m, self.row(cycle=2)).exists())
        self.review(accepted=False)
        self.assertEqual(self.run_stage(cycle=2)['state'], 'blocked-predecessor')
        self.assertEqual(self.run_stage(cycle=3)['state'], 'blocked-predecessor')
        summary = l.summarize(self.m)['arms']['A']
        self.assertEqual(summary['assigned'], 3)
        self.assertEqual(summary['blocked'], 2)
        self.assertEqual(summary['providerStages'], 1)
        self.assertEqual(summary['chargedSeconds'], 30)

    def test_resume_reuses_verified_stage_and_refuses_output_tampering(self):
        self.freeze()
        first = self.run_stage()
        again = self.run_stage()
        self.assertEqual(first, again)
        path = l.stage_path(self.m, self.row())
        (path / 'source/src/value.py').write_text('forged')
        with self.assertRaisesRegex(ValueError, 'Sealed stage changed'):
            self.run_stage()

    def test_interrupted_stage_requires_explicit_abandonment_never_silent_rerun(self):
        self.freeze()
        row = self.row()
        path = l.stage_path(self.m, row)
        path.mkdir(parents=True)
        h.write_json(path / 'run.json', dict(row, state='running'))
        with self.assertRaisesRegex(ValueError, 'incomplete'):
            self.run_stage()
        self.assertEqual(l.summarize(self.m)['arms']['A']['incomplete'], 1)
        l.abandon_stage(self.m, row, 'Provider was terminated; retain this assigned failure.')
        self.assertEqual(self.run_stage()['state'], 'abandoned')
        self.assertEqual(self.run_stage(cycle=2)['state'], 'blocked-predecessor')
        with self.assertRaises(ValueError):
            l.abandon_stage(self.m, row, 'retry')

    def test_notes_and_harness_are_frozen_and_hooks_cannot_erase_canonical_prompt_notes(self):
        original_notes = '\uFEFFCommon uncertainty.\r\nPreserve rejected alternatives.\r\n'
        (self.root / 'initial.md').write_bytes(original_notes.encode())
        self.m['arms'][1]['prepare'] = [[sys.executable, '-c', 'from pathlib import Path; import sys; Path(sys.argv[1]).write_text("Structured brief: uncertainty retained.")', '{context}']]
        self.freeze()
        self.run_stage('B')
        prompt = (l.stage_path(self.m, self.row('B')) / 'prompt.txt').read_text()
        self.assertIn(original_notes.encode(), (l.stage_path(self.m, self.row('B')) / 'prompt.txt').read_bytes())
        self.assertIn('Structured brief: uncertainty retained.', prompt)
        (self.root / 'initial.md').write_text('new solution clue')
        with self.assertRaisesRegex(ValueError, 'Protected input changed'):
            l.verify_freeze(self.m, self.manifest)

    def test_handoff_utf8_byte_cap_is_shared_complete_or_fail_and_keeps_failed_assignment(self):
        self.m['budgets']['handoffMaxBytes'] = 8
        self.provider.write_text(self.provider.read_text() + '\n(root/"PILOT_HANDOFF.md").write_text("🧪"*3)\n')
        self.freeze()
        for arm in ('A', 'B'):
            run = self.run_stage(arm)
            self.assertEqual(run['state'], 'harness-failed')
            self.assertIn('exceeds 8 UTF-8 bytes', run['harnessError'])
            path = l.stage_path(self.m, self.row(arm))
            self.assertIn('within 8 UTF-8 bytes', (path / 'prompt.txt').read_text())
            self.assertFalse((path / 'retained-notes.md').exists(), 'Never retain a truncated handoff')
        self.assertEqual(l.summarize(self.m)['assigned'], 6)
        exact = self.root / 'exact.md'
        exact.write_bytes('🧪🧪'.encode())
        self.assertEqual(l.handoff_input(exact, 8), '🧪🧪')

    def test_preparation_source_mutation_fails_before_provider_and_cannot_be_accepted(self):
        self.m['arms'][0]['prepare'] = [[sys.executable, '-c', 'from pathlib import Path; Path("src/value.py").write_text("hidden solution")']]
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['state'], 'harness-failed')
        self.assertNotIn('provider', run)
        self.assertIn('Preparation changed source', run['harnessError'])
        with self.assertRaises(ValueError):
            self.review()
        self.assertEqual(l.summarize(self.m)['arms']['A']['chargedSeconds'], 10)

    def test_protected_test_tampering_is_not_carried_and_fails_acceptance(self):
        self.provider.write_text(self.provider.read_text() + '\n(root/"src/value.test.py").write_text("always pass")\n')
        self.freeze()
        run = self.run_stage()
        self.assertTrue(run['protectedChecksPass'])
        self.assertEqual(len(run['scope']['rejected']), 1)
        self.assertEqual((l.stage_path(self.m, self.row()) / 'source/src/value.test.py').read_text(), 'trusted test')
        with self.assertRaisesRegex(ValueError, 'scope cannot be accepted'):
            self.review()

    def test_oracle_mutation_cannot_enter_the_next_source_lineage(self):
        self.m['missions'][0]['cycles'][0]['oracle']['argv'] = [sys.executable, '-c', 'from pathlib import Path; Path("src/value.py").write_text("evaluator solution")']
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['state'], 'harness-failed')
        self.assertIn('evaluation mutated', run['harnessError'])
        self.assertEqual((l.stage_path(self.m, self.row()) / 'source/src/value.py').read_text(), '1')
        with self.assertRaises(ValueError):
            self.review()

    def test_retained_cache_named_subtrees_are_sealed_and_cannot_hide_symlinks(self):
        self.provider.write_text(self.provider.read_text() + '\n(state/"node_modules").mkdir(); (state/"node_modules/observation.txt").write_text("retained")\n')
        self.freeze()
        self.run_stage()
        path = l.stage_path(self.m, self.row())
        (path / 'retained-state/.memory/node_modules/observation.txt').write_text('tampered retained knowledge')
        with self.assertRaisesRegex(ValueError, 'Sealed stage changed'):
            l.verify_stage(self.m, self.row())
        symlink_source = self.root / 'retention-probe'
        (symlink_source / 'state/node_modules').mkdir(parents=True)
        (symlink_source / 'state/node_modules/foreign').symlink_to(self.root / 'initial.md')
        with self.assertRaisesRegex(ValueError, 'cannot contain symlinks'):
            l.copy_retained(symlink_source, self.root / 'copied-retention', ['state'])

    def test_cli_run_resumes_completed_outputs_without_launching_provider_again(self):
        self.freeze()
        command = [sys.executable, str(Path(l.__file__)), 'run', str(self.manifest), '--stage-id', self.row()['id']]
        first = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(first.returncode, 0, first.stderr)
        path = l.stage_path(self.m, self.row())
        original_seal = (path / 'seal.json').read_bytes()
        second = subprocess.run(command, capture_output=True, text=True)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertEqual(original_seal, (path / 'seal.json').read_bytes())
        run = json.loads((path / 'run.json').read_text())
        self.workspaces.extend(Path(run[key]).parent for key in ('workspace', 'evaluation'))

    def test_review_is_append_only_and_predecessor_decision_is_bound_to_child(self):
        self.freeze()
        self.run_stage()
        self.review()
        with self.assertRaisesRegex(ValueError, 'already recorded'):
            self.review(accepted=False)
        self.run_stage(cycle=2)
        review_path = l.stage_path(self.m, self.row()) / 'review.json'
        decision = json.loads(review_path.read_text())
        decision['rationale'] = 'changed after descendant execution'
        h.write_json(review_path, decision)
        with self.assertRaisesRegex(ValueError, 'Predecessor review.json changed'):
            l.verify_stage(self.m, self.row(cycle=2))

    def test_concurrent_reviews_cannot_replace_the_first_exclusively_written_decision(self):
        self.freeze()
        self.run_stage()
        barrier = Barrier(2)
        original = l.write_once
        def overlapping_write(path, value):
            barrier.wait(timeout=5)
            original(path, value)
        def decide(accepted):
            try:
                self.review(accepted=accepted)
                return accepted
            except FileExistsError:
                return 'exclusive-create-rejected'
        with patch.object(l, 'write_once', overlapping_write):
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results = list(pool.map(decide, [True, False]))
        self.assertEqual(results.count('exclusive-create-rejected'), 1)
        winner = next(result for result in results if isinstance(result, bool))
        self.assertEqual(l.read_review(l.stage_path(self.m, self.row()))['accepted'], winner)

    def test_retained_escape_overlapping_production_and_excess_assignments_rejected(self):
        for retained in ['../escape', 'src/state', '.git', 'PILOT_HANDOFF.md', './.memory', '.memory/',
                         '.memory//archive.json', '.memory/./archive.json', '.memory\\archive.json', './src']:
            m = copy.deepcopy(self.m)
            m['arms'][0]['retainedPaths'] = [retained]
            with self.assertRaises(ValueError, msg=retained):
                l.validate_manifest(m)
        m = copy.deepcopy(self.m)
        m['missions'] = [dict(copy.deepcopy(m['missions'][0]), id=str(i)) for i in range(3)]
        with self.assertRaisesRegex(ValueError, '12 assigned'):
            l.validate_manifest(m)

    def test_retained_overlap_uses_path_components_and_validates_finalizer_argv(self):
        m = copy.deepcopy(self.m)
        m['missions'][0]['productionRoots'] = ['./src/']
        m['arms'][0]['retainedPaths'] = ['src/state']
        with self.assertRaisesRegex(ValueError, 'disjoint'):
            l.validate_manifest(m)
        m['arms'][0]['retainedPaths'] = ['src2/state']
        l.validate_manifest(m)
        for malformed in ['echo hidden shell', [[]], [['command', 1]]]:
            m['arms'][0]['finalize'] = malformed
            with self.assertRaisesRegex(ValueError, 'finalize hooks'):
                l.validate_manifest(m)

    def test_retained_ancestor_alias_is_rejected_at_freeze_even_when_leaf_is_absent(self):
        external = self.root / 'external'
        external.mkdir()
        sentinel = external / 'sentinel.txt'
        sentinel.write_text('keep external data')
        (self.root / 'base/state').symlink_to(external, target_is_directory=True)
        self.m['arms'][0]['retainedPaths'] = ['state/memory']
        self.assertFalse((external / 'memory').exists())
        with self.assertRaisesRegex(ValueError, 'traverses a symlink'):
            self.freeze()
        self.assertEqual(sentinel.read_text(), 'keep external data')
        self.assertFalse((external / 'memory').exists())

    def test_provider_created_retained_ancestor_cannot_delete_external_memory_during_overlay(self):
        external = self.root / 'external'
        (external / 'memory').mkdir(parents=True)
        sentinel = external / 'memory/sentinel.txt'
        sentinel.write_text('keep external data')
        self.m['arms'][0]['retainedPaths'] = ['state/memory']
        self.m['provider']['argv'].append(str(external))
        self.provider.write_text('''from pathlib import Path
import sys
root=Path(sys.argv[1])
(root/'src/value.py').write_text('1')
(root/'PILOT_HANDOFF.md').write_text('Observed bounded change.')
(root/'state').symlink_to(Path(sys.argv[5]), target_is_directory=True)
''')
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['state'], 'harness-failed')
        self.assertEqual(run['provider']['exitCode'], 0)
        self.assertIn('traverses a symlink', run['harnessError'])
        self.assertTrue((external / 'memory').is_dir())
        self.assertEqual(sentinel.read_text(), 'keep external data')

    def test_provider_created_retained_leaf_alias_is_rejected_before_finalizer(self):
        external = self.root / 'external-leaf'
        external.mkdir()
        sentinel = external / 'sentinel.txt'
        sentinel.write_text('keep external data')
        self.m['provider']['argv'].append(str(external))
        self.m['arms'][0]['finalize'] = [[sys.executable, '-c',
            'from pathlib import Path; Path(".memory/finalized.txt").write_text("must not be written")']]
        self.provider.write_text('''from pathlib import Path
import sys
root=Path(sys.argv[1])
(root/'src/value.py').write_text('1')
(root/'PILOT_HANDOFF.md').write_text('Observed bounded change.')
(root/'.memory').symlink_to(Path(sys.argv[5]), target_is_directory=True)
''')
        self.freeze()
        run = self.run_stage()
        self.assertEqual(run['state'], 'harness-failed')
        self.assertIn('traverses a symlink', run['harnessError'])
        self.assertFalse((external / 'finalized.txt').exists())
        self.assertEqual(sentinel.read_text(), 'keep external data')

    def test_retained_copy_rejects_source_and_target_ancestors_but_allows_root_alias(self):
        external = self.root / 'external'
        (external / 'memory').mkdir(parents=True)
        sentinel = external / 'memory/sentinel.txt'
        sentinel.write_text('keep external data')
        source, target = self.root / 'copy-source', self.root / 'copy-target'
        source.mkdir()
        target.mkdir()
        (source / 'state').symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'traverses a symlink'):
            l.copy_retained(source, target, ['state/memory'])
        (source / 'state').unlink()
        (source / 'state/memory').mkdir(parents=True)
        (source / 'state/memory/new.txt').write_text('new state')
        (target / 'state').symlink_to(external, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'traverses a symlink'):
            l.copy_retained(source, target, ['state/memory'])
        self.assertFalse((external / 'memory/new.txt').exists())
        self.assertEqual(sentinel.read_text(), 'keep external data')
        (target / 'state').unlink()
        alias = self.root / 'source-alias'
        alias.symlink_to(source, target_is_directory=True)
        l.copy_retained(alias, target, ['state/memory'])
        self.assertEqual((target / 'state/memory/new.txt').read_text(), 'new state')

    def test_expansion_preserves_json_and_adds_source_and_ordinal(self):
        self.assertEqual(l.expand(['{"option":"safe"}', '{cycleNumber}', '{base}', '{unknown}'], {'cycleNumber': 2, 'base': '/frozen/{arm}', 'arm': 'B'}),
                         ['{"option":"safe"}', '2', '/frozen/{arm}', '{unknown}'])


if __name__ == '__main__':
    unittest.main()
