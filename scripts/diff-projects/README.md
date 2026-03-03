# diff-projects

Compare feature flags and segments between two LaunchDarkly projects.

Fetches flags and segments from both projects, strips instance-specific noise (IDs, timestamps, versions), and produces a single structured diff. Useful for auditing project forks, validating migrations, or keeping multiple projects in sync.

## Usage

```
diff-projects.ts <project-a> <project-b> --env <env> [options]
```

### Arguments

| Argument | Description |
|---|---|
| `project-a` | First project key (left side of diff) |
| `project-b` | Second project key (right side of diff) |

### Options

| Option | Description |
|---|---|
| `--env, -e` | Environment key to compare (required, repeatable) |
| `--format, -f` | Output format — see below (default: `jsonpatch`) |
| `--base-url` | LaunchDarkly API base URL (default: `https://app.launchdarkly.com/`) |
| `--help, -h` | Show help |

### Environment Variables

| Variable | Description |
|---|---|
| `LAUNCHDARKLY_API_KEY` or `LD_API_KEY` | API key (required) |
| `LAUNCHDARKLY_BASE_URI` | Alternative to `--base-url` |

## Output Formats

The diff is always structured as:

```json
{
  "flags": { "<flag-key>": { ... } },
  "segments": { "<segment-key>": { ... } }
}
```

Diagnostic output (progress, summary counts) goes to **stderr**. The diff goes to **stdout**.

### `jsonpatch` (default)

RFC 6902 JSON Patch — an array of operations describing what changed. Easy to read and process programmatically.

```json
[
  { "op": "replace", "path": "/flags/my-flag/environments/production/on", "value": true },
  { "op": "add", "path": "/flags/new-flag", "value": { ... } },
  { "op": "remove", "path": "/segments/old-segment" }
]
```

### `console`

ANSI-colored human-readable output. Additions in green (`+`), removals in red (`-`), modifications shown as `old => new`. Not JSON — pipe to a terminal.

### `delta`

Raw [jsondiffpatch](https://github.com/benjamine/jsondiffpatch) delta format. Compact but requires knowing the delta spec (`[newVal]` = added, `[old, new]` = modified, `[old, 0, 0]` = deleted).

## Examples

```sh
# Compare production environment, get RFC 6902 patch
diff-projects.ts proj-a proj-b --env production

# Compare multiple environments
diff-projects.ts proj-a proj-b -e production -e staging

# Human-readable terminal output
diff-projects.ts proj-a proj-b -e production --format console

# Filter to only flag changes using jq
diff-projects.ts proj-a proj-b -e production | jq '.flags'

# Find all removed flags
diff-projects.ts proj-a proj-b -e production | jq '[.[] | select(.op == "remove" and (.path | split("/") | length == 3))]'

# Save diff for later
diff-projects.ts proj-a proj-b -e production > diff.json 2>progress.log
```

## What Gets Diffed

**Flags** — compared at two levels:
- Flag-level attributes: `name`, `description`, `tags`, `kind`, `variations`, `defaults`, `customProperties`, etc.
- Per-environment config: targeting rules, clauses, targets, rollouts, prerequisites, on/off state, fallthrough, etc.

**Segments** — per environment: included/excluded lists, rules, clauses.

## What Gets Stripped

Fields that are inherently instance-specific and will never match across projects are removed before diffing:

| Scope | Stripped fields |
|---|---|
| All objects (recursive) | `_id`, `_links` |
| Flag level | `_version`, `creationDate`, `_debugEventsUntilDate` |
| Flag environment config | `salt`, `lastModified`, `version`, `_site`, `_environmentName`, `_summary`, `sel` |
| Segments | `creationDate`, `lastModifiedDate`, `version`, `generation` |

## Requirements

- [Deno](https://deno.land/) 1.x or later
- A LaunchDarkly API key with read access to both projects
