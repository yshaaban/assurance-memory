# Input schemas

These JSON Schema 2020-12 documents support editor/CI validation; the server retains its own authoritative validation and authorization. They are not automatically loaded by the runtime. The authoring forms require explicit safety-relevant fields even where the HTTP kernel has documented defaults.

`claim.schema.json` describes reviewed requirement input, `model.schema.json` the finite-state safety language, and `workspace.schema.json` scanner configuration. Cross-field relationships (such as domain/variable equality, selector/component membership, exact revisions, graph cycles, and source completeness) are checked by the kernel. A schema pass is not an assurance result.
