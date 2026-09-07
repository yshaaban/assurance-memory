# Publishing and release maintenance

The repository is distributed as source. npm workspaces remain `private: true`; publishing this GitHub repository does not publish npm packages, deploy a service, or assert production readiness.

## Version boundaries

The Node tooling is version 1.1.0. The retained Java Maven modules and JAR filenames are version 1.0.0. This distinction is intentional for the current publication snapshot; the Java API gained a read-only frontier operation without changing its existing authority semantics. Treat a future synchronized package release as a separate versioning decision. No compatibility is implied between arbitrary extractor/index revisions.

The local index schema version is recorded with SQLite `user_version`; newer unsupported schemas are rejected. Context fingerprints cover source/compiler assumptions and local candidate-policy implementation. Any identity or detector change must document its effect on drift and evidence reuse.

## Before publishing a change

1. Follow [contributing](../CONTRIBUTING.md), run the appropriate tests and check links/examples.
2. Keep local indexes, private task banks, source reports, credentials and generated build artifacts outside Git. Check the actual history being pushed, not only the working tree.
3. Compare README claims against [validation](VALIDATION_1_1.md). Mark historical evidence and unexecuted checks explicitly.
4. Confirm the lockfile, supported Node/JDK versions and executable examples agree with CI.
5. Describe user-visible behavior, migration requirements, measured limits and unresolved risks in the changelog.
6. Push only reviewed branches. Check both GitHub Actions jobs after publication.

The initial public commit intentionally excludes private local project reports and prepublication working history. Historical source-manifest records are under [history](history/README.md); they do not attest the current repository's integrity.

## Artifacts and tagging

Do not create a production-ready release based solely on a synthetic index benchmark. Before tagging a release, validate a fresh source checkout, the packaged Spring/PostgreSQL path, and supported local runtime behavior. Document the scope of any release artifact, retained Java/Node version differences, and any extraction/identity migration.

A GitHub source release may be created after those checks when explicitly requested. Docker deployment, image publication and npm distribution are separate actions with their own validation paths. Container execution was not established by the local validation report.

## Licensing

No project license has been selected in this publication. Public visibility alone does not grant an open-source license. Add a license only after the repository owner chooses terms and confirms the source can be distributed under them.
