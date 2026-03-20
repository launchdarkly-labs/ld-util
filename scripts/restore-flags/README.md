# restore-flags

Restore flag environment configurations from a JSONL snapshot using JSON Patch (RFC 6902).

Reads flag objects from stdin (one JSON object per line, as returned by the LD API) and PATCHes each flag's per-environment config back. Flags must already exist in the target project — this script restores environment settings, not the flag definitions themselves.

## Usage

```bash
cat deleted-flags.jsonl | deno run --allow-net --allow-env scripts/restore-flags/restore-flags.ts [--execute]
```

Without `--execute`, runs in dry-run mode and prints the patch ops to stdout.

### Filtering

Since it reads from stdin, you can pipe through `jq` to restore a subset:

```bash
# Only release flags
cat deleted-flags.jsonl | jq -c 'select(.key | startswith("release-"))' | deno run --allow-net --allow-env scripts/restore-flags/restore-flags.ts --execute

# Only a specific flag
cat deleted-flags.jsonl | jq -c 'select(.key == "my-flag")' | deno run --allow-net --allow-env scripts/restore-flags/restore-flags.ts --execute
```

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `LD_API_KEY` | Yes | LaunchDarkly API access token |
| `LD_API_ENDPOINT` | No | API base URL (defaults to `https://app.launchdarkly.com`) |

## What it restores

Per environment, the following fields are patched:

- `on` — flag toggle state
- `archived` — per-environment archive state
- `targets` — individual user targets
- `contextTargets` — multi-context targets
- `rules` — targeting rules and clauses
- `fallthrough` — default variation or rollout
- `offVariation` — variation served when flag is off
- `prerequisites` — flag dependencies
- `trackEvents` — event tracking
- `trackEventsFallthrough` — fallthrough event tracking

Server-assigned fields (`_id`, `salt`, `sel`, `version`, `lastModified`) are stripped and not included in the patch.

## Input format

Each line must be a full flag object as returned by `GET /api/v2/flags/{projectKey}` with environment data included. The project key is extracted from `_links.parent.href`. Invalid JSON lines are skipped with a warning.
