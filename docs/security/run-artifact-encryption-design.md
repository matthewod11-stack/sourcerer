# Run Artifact Encryption Design

> Status: proposed for [#21](https://github.com/matthewod11-stack/sourcerer/issues/21)  
> Goal: optional at-rest protection for PII-bearing local run artifacts without making run listing or cleanup miserable.

## Problem

Sourcerer writes run artifacts under `runs/<date-role>/`. Today these files are gitignored but plaintext:

- `candidates.json` — high sensitivity: names, URLs, evidence, emails/phones/addresses when adapters provide them, retention metadata.
- `checkpoint.json` — high sensitivity: phase outputs can include discovered/enriched candidates and PII.
- output files such as Markdown/CSV/JSON reports — high sensitivity when they include candidate details.
- `run-meta.json` — low sensitivity if kept to run id, role name, timings, cost, counts, status, prompt versions.

Plaintext is acceptable for a local single-user dev posture, but not for shared Macs, synced folders, servers, or hosted deployments.

## Design Principles

1. **Opt-in first.** Do not surprise existing local users by making old runs unreadable.
2. **Encrypt PII-bearing artifacts, not ergonomic metadata.** `run-meta.json` stays plaintext and intentionally non-sensitive so `sourcerer runs list` remains fast and useful.
3. **Fail closed when encryption is enabled.** If a protected artifact cannot be decrypted, commands should stop with an actionable error rather than silently treating the run as absent.
4. **No homegrown crypto.** Use Node `crypto` primitives: AES-256-GCM with random nonce and authentication tag.
5. **Key material never goes in the repo or run directory.** Store only non-secret key ids / encryption metadata beside encrypted files.
6. **Migration is explicit.** Existing plaintext runs remain readable; encryption can be applied with a migration command later.

## Configuration

Add a `runArtifacts.encryption` section to `~/.sourcerer/config.yaml`:

```yaml
runArtifacts:
  encryption:
    enabled: false
    keyProvider: env # env | keychain-later
    keyEnv: SOURCERER_ARTIFACT_KEY
    keyId: local-default
```

Initial implementation should support only `keyProvider: env`.

- `SOURCERER_ARTIFACT_KEY` should be a base64url or base64 encoded 32-byte key.
- `sourcerer init` can generate and print a one-time key export command, but should not write the key into the repo.
- Future macOS-specific work can add Keychain support without changing artifact format.

## Artifact Format

Protected files are written as an envelope with an `.enc.json` suffix:

```json
{
  "version": 1,
  "algorithm": "AES-256-GCM",
  "keyId": "local-default",
  "nonce": "base64url-12-bytes",
  "tag": "base64url-16-bytes",
  "createdAt": "2026-07-03T00:00:00.000Z",
  "plaintextFilename": "candidates.json",
  "ciphertext": "base64url-ciphertext"
}
```

Plaintext file behavior when encryption is enabled:

| Logical artifact | Plaintext path | Encrypted path | Notes |
|---|---|---|---|
| Candidates | `candidates.json` | `candidates.json.enc.json` | Do not leave plaintext twin after successful encrypted write. |
| Checkpoint | `checkpoint.json` | `checkpoint.json.enc.json` | Needed because phase outputs can contain PII. |
| Markdown report | `report.md` | `report.md.enc.json` | Output adapters should opt into protected writes for candidate reports. |
| CSV/JSON export | `*.csv`, `*.json` | `*.csv.enc.json`, `*.json.enc.json` | Depends on output adapter sensitivity. |
| Run metadata | `run-meta.json` | none | Keep plaintext; audit fields to ensure no PII. |

## Read / Write Contract

Introduce a small artifact I/O boundary, ideally in `packages/core/src/run-artifacts.ts` or a new `packages/core/src/artifact-store.ts`:

```ts
interface ArtifactStore {
  writeText(runDir: string, filename: string, content: string, options?: { sensitive?: boolean }): Promise<void>;
  readText(runDir: string, filename: string, options?: { sensitive?: boolean }): Promise<string>;
}
```

Behavior:

- When encryption disabled: read/write the existing plaintext filename.
- When encryption enabled and `sensitive: true`: write/read the `.enc.json` envelope.
- When encryption enabled and reading: prefer encrypted file; if only plaintext exists, read plaintext and mark it as legacy plaintext in logs.
- When encryption disabled and only encrypted exists: fail with `Encrypted artifact found but artifact encryption is disabled or no key is configured`.

## Code Touchpoints

First implementation slice should keep scope narrow:

1. `packages/core/src/artifact-encryption.ts`
   - key parsing
   - AES-GCM encrypt/decrypt
   - envelope schema validation
   - unit tests proving ciphertext does not contain raw PII
2. `packages/core/src/artifact-store.ts`
   - encrypted/plaintext read-write adapter
   - fallback and error messages
3. `apps/cli/src/run-loader.ts`
   - `loadCandidates` / `writeCandidates` use `ArtifactStore` for `candidates.json`
4. `packages/core/src/checkpoint.ts`
   - `saveCheckpoint` / `loadCheckpoint` accept optional artifact store or encryption options
5. `apps/cli/src/commands/candidates.ts`
   - purge reads/writes via the same store so encrypted artifacts preserve purge semantics
6. Output adapters
   - candidate-detail exports should use protected writes; `run-meta.json` remains plaintext

## Metadata Visibility

`run-meta.json` should remain plaintext but must be audited to exclude PII. Safe fields:

- `runId`
- `roleName` (borderline but useful; acceptable for local run listing)
- `startedAt`, `completedAt`, `status`, duration
- phase timing and cost numbers
- candidate counts
- prompt versions

Do **not** add candidate names, emails, profile URLs, evidence snippets, or source URLs to `run-meta.json`.

## Purge Behavior

`sourcerer candidates purge --expired` must work for encrypted and plaintext runs:

1. List runs from plaintext `run-meta.json`.
2. Load candidates through the artifact store.
3. Redact expired PII in memory.
4. Write candidates back through the artifact store.
5. Preserve encryption state: encrypted input stays encrypted; if encryption is enabled for a legacy plaintext input, write encrypted output and remove plaintext only after the encrypted write succeeds.

Fail closed if a run has encrypted candidates but the key is unavailable.

## Migration Behavior

Add an explicit future command:

```bash
sourcerer runs encrypt --all
sourcerer runs decrypt --run <run-id> --yes
```

Migration rules:

- Dry-run by default: show affected runs and files.
- Encrypt command writes `.enc.json` first, verifies decrypt/readback, then deletes plaintext.
- Decrypt command requires `--yes` and prints a warning because it reintroduces plaintext PII.
- Existing plaintext runs remain readable until the operator opts in.

## Failure Modes

| Failure | Behavior |
|---|---|
| Encryption enabled but key missing | Abort before writing sensitive artifacts; explain `SOURCERER_ARTIFACT_KEY`. |
| Wrong key / auth tag mismatch | Abort with `Artifact decryption failed; key may be wrong or file corrupted`. |
| Encrypted + plaintext twins exist | Prefer encrypted; warn that plaintext twin should be removed. |
| Encrypted write succeeds but plaintext deletion fails | Warn loudly; command exits non-zero for migration, but normal writes should not create plaintext first. |
| Run listing sees encrypted candidates | Listing still works from `run-meta.json`; detailed candidate commands require key. |

## Tests

Minimum implementation tests:

- AES-GCM round trip returns original JSON.
- Ciphertext envelope does **not** contain a sentinel email such as `alice@example.com`.
- Decrypting with the wrong key fails.
- `writeCandidates` with encryption enabled does not create plaintext `candidates.json`.
- `loadCandidates` reads encrypted candidates.
- `purge --expired` redacts encrypted candidates and writes them back encrypted.
- Legacy plaintext candidates remain readable when encryption is enabled.

## Recommended Implementation Slices

1. **Crypto primitive + tests** — no CLI behavior change.
2. **Candidate artifact encryption behind env/config** — closes the biggest PII file first.
3. **Checkpoint encryption** — covers interrupted/resumable runs.
4. **Purge compatibility** — encrypted read/write round trip for retention operations.
5. **Output adapter protection** — JSON/CSV/Markdown reports.
6. **Migration commands** — encrypt/decrypt existing local runs.

This order gives fast security lift without turning the whole run-management system into a rewrite.
