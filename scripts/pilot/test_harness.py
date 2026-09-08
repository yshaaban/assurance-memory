import json
import os
import shutil
import signal
import time
from unittest.mock import patch
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parent))
import harness


class HarnessTests(unittest.TestCase):
    def manifest(self, root):
        return {'schemaVersion': 1, 'studyId': 'example', 'seed': 731, 'repeats': 2, 'maxConcurrency': 2, 'outputRoot': str(root / 'results'), 'provider': {'argv': ['provider', '{workspace}']}, 'budgets': {'timeoutSeconds': 10}, 'arms': [{'id': 'A'}, {'id': 'B'}], 'tasks': [{'id': 'example', 'family': 'repair', 'base': str(root / 'base'), 'prompt': 'Repair observed output.', 'productionRoots': ['src'], 'owners': [{'path': 'src/owner.ts', 'rationale': 'Owns output.'}], 'oracle': {'argv': ['true']}}]}

    def test_schedule_is_seeded_complete_and_balanced_by_repeat(self):
        with tempfile.TemporaryDirectory() as tmp:
            m = self.manifest(Path(tmp))
            m['tasks'] *= 1
            harness.validate_manifest(m)
            first = harness.schedule(m)
            self.assertEqual(first, harness.schedule(m))
            self.assertEqual(len(first), 4)
            for repeat in (1, 2):
                self.assertEqual({r['arm'] for r in first if r['repeat'] == repeat}, {'A', 'B'})
            self.assertEqual(len({r['id'] for r in first}), 4)

    def test_manifest_rejects_escape_duplicate_and_unbounded_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            for alter in [lambda m: m['tasks'][0].update(productionRoots=['../oracle']), lambda m: m['arms'].append({'id': 'A'}), lambda m: m['budgets'].update(timeoutSeconds=721)]:
                m = self.manifest(Path(tmp))
                alter(m)
                with self.assertRaises(ValueError):
                    harness.validate_manifest(m)

    def test_overlay_keeps_trusted_tests_and_config_rejects_symlinks_and_handles_deletion(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            base, candidate, evaluation = [root / p for p in ('base', 'candidate', 'evaluation')]
            (base / 'src').mkdir(parents=True)
            for name, text in [('owner.ts', 'broken'), ('deleted.ts', 'obsolete'), ('owner.test.ts', 'assert real behavior'), ('vitest.config.ts', 'trusted')]:
                (base / 'src' / name).write_text(text)
            harness.copy_tree(base, candidate)
            (candidate / 'src/owner.ts').write_text('fixed')
            (candidate / 'src/owner.test.ts').write_text('always pass')
            (candidate / 'src/vitest.config.ts').write_text('disable oracle')
            (candidate / 'src/deleted.ts').unlink()
            (candidate / 'src/new.test.ts').write_text('supplemental')
            (candidate / 'src/escape.ts').symlink_to(root / 'secret')
            task = self.manifest(root)['tasks'][0]
            scope = harness.overlay(base, candidate, evaluation, task)
            self.assertEqual((evaluation / 'src/owner.ts').read_text(), 'fixed')
            self.assertEqual((evaluation / 'src/owner.test.ts').read_text(), 'assert real behavior')
            self.assertEqual((evaluation / 'src/vitest.config.ts').read_text(), 'trusted')
            self.assertFalse((evaluation / 'src/deleted.ts').exists())
            self.assertFalse((evaluation / 'src/new.test.ts').exists())
            self.assertEqual(len(scope['rejected']), 3)

    def test_process_timeout_and_launch_failure_are_charged_to_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            result = harness.process([sys.executable, '-c', 'import time; time.sleep(30)'], root, .1, root / 'out', root / 'err')
            self.assertTrue(result['timedOut'])
            self.assertGreaterEqual(result['chargedSeconds'], .1)
            failed = harness.process([str(root / 'missing')], root, 5, root / 'out', root / 'err')
            self.assertIsNone(failed['exitCode'])
            self.assertEqual(failed['chargedSeconds'], 5)

    @unittest.skipUnless(hasattr(os, 'killpg'), 'POSIX process-group contract')
    def test_timeout_kills_ignoring_descendant_after_leader_exits(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            pid_file, survived = root / 'child.pid', root / 'survived'
            child_code = (
                'import os,signal,time; from pathlib import Path; '
                'signal.signal(signal.SIGTERM,signal.SIG_IGN); '
                f'Path({str(pid_file)!r}).write_text(str(os.getpid())); '
                f'time.sleep(1); Path({str(survived)!r}).write_text("alive"); time.sleep(30)'
            )
            parent_code = f'import subprocess,sys,time; subprocess.Popen([sys.executable,"-c",{child_code!r}]); time.sleep(30)'
            try:
                result = harness.process([sys.executable, '-c', parent_code], root, .5, root / 'out', root / 'err')
                self.assertTrue(result['timedOut'])
                self.assertTrue(pid_file.exists(), 'Descendant must have started for the probe to be meaningful')
                time.sleep(.8)
                self.assertFalse(survived.exists(), 'Ignoring descendant survived its terminated parent')
            finally:
                if pid_file.exists():
                    try:
                        os.kill(int(pid_file.read_text()), signal.SIGKILL)
                    except ProcessLookupError:
                        pass

    def test_argv_expansion_preserves_json_and_does_not_expand_inserted_values(self):
        self.assertEqual(
            harness.expand(['provider', '{"mode":"safe"}', '{workspace}', '{unknown}'], {'workspace': '/example/{arm}', 'arm': 'A'}),
            ['provider', '{"mode":"safe"}', '/example/{arm}', '{unknown}'],
        )

    def test_final_response_cannot_overwrite_authored_report_or_replace_oracle_tests(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m = self.manifest(root)
            (root / 'base/src').mkdir(parents=True)
            (root / 'base/src/owner.ts').write_text('broken')
            (root / 'base/src/owner.test.ts').write_text('trusted behavior assertion')
            candidate_code = (
                'import sys; from pathlib import Path; root=Path(sys.argv[1]); '
                '(root/"src/owner.ts").write_text("fixed"); '
                '(root/"src/owner.test.ts").write_text("weakened test"); '
                '(root/"PILOT_RESULT.md").write_text("Detailed authored mechanism and evidence."); '
                'Path(sys.argv[2]).write_text("Concise provider final response.")'
            )
            m['provider']['argv'] = [sys.executable, '-c', candidate_code, '{workspace}', '{output}']
            m['tasks'][0]['oracle']['argv'] = [sys.executable, '-c', 'from pathlib import Path; assert Path("src/owner.ts").read_text()=="fixed"; assert Path("src/owner.test.ts").read_text()=="trusted behavior assertion"']
            row = harness.schedule(m)[0]
            result = harness.run_one(m, row)
            try:
                artifacts = root / 'results/runs' / row['id']
                self.assertTrue(result['protectedChecksPass'])
                self.assertEqual((artifacts / 'authored-report.md').read_text(), 'Detailed authored mechanism and evidence.')
                self.assertEqual((artifacts / 'result.md').read_text(), 'Concise provider final response.')
                self.assertEqual(result['scope']['rejected'], [{'path': 'src/owner.test.ts', 'reason': 'outside production scope or protected existing input'}])
            finally:
                shutil.rmtree(Path(result['workspace']).parent)
                if result.get('evaluation'):
                    shutil.rmtree(Path(result['evaluation']).parent)

    def test_integrity_failures_keep_assigned_denominator_and_full_budget(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m = self.manifest(root)
            m.update(repeats=1, arms=[{'id': 'A'}])
            row = harness.schedule(m)[0]
            directory = root / 'results/runs' / row['id']
            directory.mkdir(parents=True)
            harness.write_json(directory / 'run.json', dict(row, state='integrity-failed', accepted=False))
            result = harness.summarize(m)['arms']['A']
            self.assertEqual(result['assigned'], 1)
            self.assertEqual(result['accepted'], 0)
            self.assertEqual(result['integrityFailures'], 1)
            self.assertEqual(result['failedBeforeProvider'], 1)
            self.assertEqual(result['chargedSeconds'], 10)
            self.assertEqual(result['missingUsage'], 1)

    def test_child_environment_excludes_unrelated_credentials(self):
        with patch.dict(os.environ, {'HOME': '/local/home', 'CODEX_HOME': '/local/codex', 'PATH': '/bin', 'UNRELATED_API_TOKEN': 'must-not-forward', 'LC_ALL': 'C'}, clear=True):
            env = harness.child_environment()
            self.assertNotIn('UNRELATED_API_TOKEN', env)
            self.assertEqual(env['HOME'], '/local/home')
            self.assertEqual(env['CODEX_HOME'], '/local/codex')
            self.assertEqual(env['LC_ALL'], 'C')

    def test_missing_usage_is_unknown_and_observed_usage_is_summed(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'events'
            path.write_text('not-json\n')
            self.assertIsNone(harness.trace_metrics(path)['usage'])
            path.write_text(json.dumps({'type': 'turn.completed', 'usage': None}))
            self.assertIsNone(harness.trace_metrics(path)['usage'])
            path.write_text('\n'.join(json.dumps(e) for e in [{'type': 'turn.completed', 'usage': {'input_tokens': 3}}, {'type': 'turn.completed', 'usage': {'input_tokens': 7}}, {'type': 'item.completed', 'item': {'type': 'command_execution', 'command': 'read file'}}]))
            self.assertEqual(harness.trace_metrics(path)['usage']['input_tokens'], 10)
            self.assertEqual(harness.trace_metrics(path)['commandCount'], 1)

    def test_freeze_rejects_changed_oracle_and_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m = self.manifest(root)
            (root / 'base/src').mkdir(parents=True)
            source = root / 'base/src/owner.ts'
            source.write_text('original')
            oracle = root / 'oracle.py'
            oracle.write_text('trusted')
            m['protectedInputs'] = [str(oracle)]
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps(m))
            harness.freeze(m, manifest)
            harness.verify_freeze(m, manifest)
            oracle.write_text('changed')
            with self.assertRaises(ValueError):
                harness.verify_freeze(m, manifest)
            oracle.write_text('trusted')
            source.write_text('changed')
            with self.assertRaises(ValueError):
                harness.verify_freeze(m, manifest)


if __name__ == '__main__':
    unittest.main()
