# Synthetic container recovery component

`runRecovery` is invoked by the container rehearsal after HTTP journeys finish. It
requires `CI=true`, `GITHUB_ACTIONS=true`, `ONEERP_CONTAINER_REHEARSAL=1`, a
`oneerp-ci-*` source project and its exact `-restore` counterpart. Never invoke it
against production or use its result as real-data recovery acceptance.

Inputs: `root`, `composeFile`, `envFile`, `sourceProject`, `recoveryProject`,
`tempDir`, `reportPath`, `commit`, `credentials: {email,password}`, and `dockerEnv`.
The caller must have finished synthetic writes and background event processing.
It must upload only the explicit sanitized reports, never the temporary directory.

The component reuses the existing backup scripts' PostgreSQL logical dump and
MinIO volume archive approach. It does not invoke `restore-drill.sh`, because
that script rebuilds images and can initialize a database through dependencies.
The bounded component instead:

- rejects preexisting restore containers or volumes;
- resolves source running image IDs and starts the same five immutable images;
- removes published ports and migration dependencies, recreates project-scoped
  volumes, and rejects external volumes and bind mounts;
- uses `psql -X -v ON_ERROR_STOP=1`; SQL errors prevent subsequent API startup;
- extracts MinIO bytes before starting restored MinIO;
- compares every public table's count and ordered complete-row fingerprint,
  including business record IDs; requires a journey engineering revision;
- logs in through the real API and downloads every retained upload through its
  API-issued signed URL, checking SHA-256 against the database and source;
- verifies source rows remain unchanged and destroys only the restore project.

The logical dump and archive stay in process memory. Resolved Compose credentials
are private (0700 directory / 0600 file) and removed in `finally`. Reports contain
only stage status, table counts and an aggregate file-evidence hash, never SQL,
archives, environment values, credentials, file paths, tokens or signed URLs.

Validation: `node --test scripts/ci/recovery-rehearsal.test.mjs` exercises scope,
volume/image isolation and a mocked SQL failure with restore-only cleanup. These
are orchestration tests, not evidence that a real container recovery succeeded.
The GitHub container rehearsal must supply that evidence for its exact commit.
Graphify graph data and executable were absent in this checkout; no graph refresh
is claimed.
