# Generic resource ownership — Issue 28

The generic API is a reviewed master-data and read-model interface. UI metadata does not grant access to a database model. Authentication and model permissions still apply before this ownership layer.

## Policy

- `crud-access-policy.ts` explicitly registers supported roots, whether generic writes are permitted, and their ownership rule. Unknown models and dedicated identity/control resources are refused.
- Direct ownership comes from the Prisma company field. Children use a reviewed parent relation: for example BOM lines through their BOM and journal lines through their journal entry. Missing tenant context or unverifiable metadata is refused.
- Financial, inventory and other lifecycle records are read-only through this interface. Use their dedicated business APIs for mutations. Metadata flags hide unsupported generic editing while preserving authorized correction actions.
- Root list/count/detail and supported nested projections and filters share ownership guards. A legacy cross-company to-one link excludes the containing result when that relation is requested; collection projections and counts include only authorized targets. Authorization predicates cannot be negated by a caller's `NOT` or `OR`.
- Final post-hook scalar references are checked within the write transaction. Optional null references are allowed; foreign-company targets and scalar update envelopes for references are refused. Effective update state is checked, including unchanged references.
- System preset Materials with `companyId=null` are permitted as explicitly authorized references. Generic Material root access remains company-only; this change does not alter Prisma middleware or introduce globally writable materials.
- Referenced master records cannot be deleted through the generic API. This prevents database cascade/SET NULL behavior from silently changing dependent business records or malformed foreign-company references. Unreferenced master and leaf deletion remains available where policy permits.

## Compatibility and maintenance

Normal partner/material/product/category/location/warehouse/BOM/BOM-line/department/tax/account workflows remain the intended writable surface. Purchase, sales, accounting and inventory transitions must stay in dedicated services. Existing journal-line report reads remain supported through their entry's company ownership.

When adding a resource, review its root exposure, direct or explicit parent ownership, lifecycle writes, every scalar reference target and nested read projections. Update the registry, metadata affordances and preservation/adversarial tests together. Do not infer ownership by walking arbitrary relations or restore permissive fallback for missing metadata.

Invalid historical links are not automatically repaired or deleted. Authorized maintainers must inventory and reconcile them in a controlled environment. These guards cover the generic gateway; they do not certify every dedicated business endpoint or historical record.

## Verification status

Implementation and independent source review are complete. The implementation owner and separate reviewer each passed the 151 focused CRUD/metadata tests. Root full validation passed 700 tests (2 script, 602 API, 96 Web), Prisma checks, typecheck, lint and production builds.

The separate 18-case PostgreSQL ownership suite uses synthetic two-company fixtures, real Prisma queries and explicit disposable-database opt-in. Its initial execution awaits CI; local mocks are not PostgreSQL evidence. The existing 16 supplier posting cases remain in the same integration gate. Record the exact CI result before claiming database-level verification. Browser/operator acceptance and production rollout gates remain separate.
