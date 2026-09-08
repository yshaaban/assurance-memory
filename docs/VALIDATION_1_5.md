# Validation of Node tooling 1.5

Executed on 2026-09-08 with Node 24.16.0, JDK 21.0.12.1 and PostgreSQL 17 on macOS arm64. The local projection uses schema 4; Java modules remain 1.0.0. Source observations are user-reported investigation data, with no new evidence or approval authority.

## Implementation checks

| Check | Observed result | Scope |
| --- | --- | --- |
| `npm test` | 138 Node tests; 43 Python tests; 25 Java scenarios / 85 assertions pass | Shared extraction, SQLite, CLI/MCP, HTTP, archive lifecycle and pilot boundaries |
| `mvn -B -ntp -Ppostgres-it verify` | Build succeeds; 10 real PostgreSQL assertions pass | Persistence, rollback, concurrency and isolation |
| `bash scripts/test-spring.sh` | Seed and restart-persistence pass | Packaged service survives restart |
| Independent code reviews | Filename selection and task-packet output collision defects fixed; follow-up directory compatibility regression fixed | Architecture/simplicity and integrity/protocol perspectives |
| Independent publication review | No private application source/tasks, secret-shaped values or personal commit emails in reviewed public changes | Read-only review of public diff and history; documentation corrections applied |

The disposable PostgreSQL server and Spring processes were stopped after checks. The full suite is rerun after release code fixes. Documentation changes do not add new runtime behavior.

Source lifecycle checks exercise real compiler value-only changes, enclosing-file declarations, direct dependency membership, deleted citations, source disappearance/recreation, reversion and explicit re-review. Migration preserves schema-3 records and local precedence; a failed scan rolls back the schema upgrade. Candidate-only version-1 archives remain compatible, while mixed version-2 archives preserve original candidate digests. Imported source notes remain stale or absent and never create findings or discount candidate priority.

A real candidate-free integration goes through scan, source review, quiescent export, fresh-checkout import, brief delivery, explicit re-review and subsequent source invalidation. Export tests preserve original SQLite DB/WAL/SHM bytes, refuse unsafe targets and preserve old archives on failure. Packet tests reject DB/sidecar output aliases before writes while preserving automatic creation of missing index directories. These checks do not prove arbitrary user reasoning correct or make concurrent file copying safe.

## Retrieval and read costs

The [independent retrieval report](RETRIEVAL_1_5.md) preserves all five scored tasks, including a lost intentional counterexample. New ranking retrieves 4/4 owners and 3/3 consumers versus 3/4 and 2/3 previously, but only 1/2 counterexamples versus 2/2. Full packets are larger in this sample. Ordinary fixed search is a separate comparator, not adaptive agent work. The held-out result was not rescored after a separately reviewed filename fix; exact measured implementation hashes remain in the raw report.

A synthetic warm in-memory probe used 1,200 facts, 3,600 source notes and 200 context/history reads. Context median was 0.098 ms after notes, versus 0.092 ms before; p95 was 0.117 ms. History median was 0.029 ms. Reads do not rehash dependencies. These are small local read-path observations, not cold-database or production capacity claims.

## Full-project preflight

Two fresh committed project snapshots were used without editing the original working trees or installing dependencies. Fourteen private controls matched expected outcomes: existing behavior, genuinely failing repair targets, reference fixes, prospective policy changes, intentional no-change cases and harmful broader changes. These controls establish that the bounded oracles discriminate the chosen mechanisms; they are evaluator-authored and remain private.

The first provider-free transport attempt failed because its deterministic driver passed `--json` to a CLI command requiring `--input`. Both structured drivers failed; the two plain drivers completed. The failed artifacts and original driver inputs were retained. No model was invoked and no model trial was replaced.

After correcting the driver, eight deterministic stages passed: two projects, two arms and two successive cycles. Both arms retain plain notes and separately sealed authored tests; those tests remain excluded from protected evaluation. Structured stages create a new physical-root index, export nonempty source history, restore it stale, append explicit local re-review and preserve original files through finalization. A subsequent control exercised the evaluator-owned frozen finalizer against both final preflight indexes and preserved at least two originating source records. No preflight notes or reference changes enter the model-study bases.

Observed first-cycle task preparation in that preflight:

| Snapshot | Configured components | Indexed facts | Task hook wall time | Complete delivered packet |
| --- | ---: | ---: | ---: | ---: |
| Project P | 3 | 34,932 | 16.811 s | 47,959 bytes |
| Project Q | 1 | 10,607 | 6.313 s | 34,082 bytes |

Both reported complete configured discovery. These timings include extraction and task preparation, were collected alongside other preflight work, and cover only the configured components. The nested brief has its own byte limit; complete packets also contain scan coverage and provenance. They are not whole-repository capacity or incremental-scan benchmarks.

## Fresh paired study

Study outcomes and independent review are recorded after all twelve assigned stages finish. The frozen design uses two missions, two arms, three cycles, a 720-second provider ceiling and at most two concurrent providers. Both arms receive plain notes and authored-test retention. The structured arm additionally receives fresh task context and source-observation archives. No replacement model trials are allowed.

## Final path-alias review

After the model study was frozen, an additional APFS probe found that differently cased sidecar output paths could evade string comparisons. Task-start now compares the reserved packet inode/device with every canonical/physical database and sidecar path before opening SQLite, and rejects dangling database leaf symlinks. Task-end uses conservative normalized case-folded path comparisons before copying or publishing. Seven focused integration tests and independent reviewer reproductions pass. These changes harden output paths; the study keeps its exact earlier helper bytes and ordinary non-aliasing paths. No provider was rerun to incorporate the correction.
