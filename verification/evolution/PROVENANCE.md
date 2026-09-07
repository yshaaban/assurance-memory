# Provenance

The project evolved from the supplied Assurance Memory 1.0.0 source archive. The public repository starts from a reviewed publication snapshot; prepublication local history and private project reports are not included. A connected build generated the npm lockfile.

Source archive SHA-256:

- `assurance-memory-1.0.0.zip`: `a7b20529db1971ff377c630c17ee13df2df8f63acbe27438939de4b65e068a32`
- `contractgraph-0.1.0-source.zip`: `044950a7d110d2181ed54c00a4b5b395522c37c459483eda262c0d624341facc`

`docs/history/assurance-memory-1.0.0-manifest.json` is the original download's manifest. It describes the supplied files, not an integrity attestation of the evolved working tree. Git records changes from the reviewed public snapshot onward. Download-era verification files likewise describe the original environment; see `docs/VALIDATION_1_1.md` for new execution evidence.

The local SQLite stores and temporary PostgreSQL cluster are ignored build artifacts. The PostgreSQL process is stopped after verification; no service is registered to start at login. Homebrew-installed JDK/Maven/PostgreSQL tools remain available on this machine. The project tests used JDK 21 through an explicit PATH; no shell startup files were changed.

Captured text logs have trailing whitespace normalized and personal filesystem prefixes replaced by `/workspace/assurance-memory`; test outcomes are unchanged. Private application reports and source identifiers are excluded.
