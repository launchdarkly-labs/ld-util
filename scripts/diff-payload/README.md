# diff-payload

Compare the SDK polling payloads from two LaunchDarkly environments.

Fetches `/sdk/latest-all` for each SDK key and diffs the flag and segment rules. This operates at the SDK level — comparing exactly what clients receive — making it useful for verifying environment parity, debugging evaluation differences, or auditing what an SDK actually sees.

## Usage

```
diff-payload.ts <sdk-key-a> <sdk-key-b> [options]
```

### Arguments

| Argument | Description |
|---|---|
| `sdk-key-a` | First SDK key (left side of diff) |
| `sdk-key-b` | Second SDK key (right side of diff) |

### Options

| Option | Description |
|---|---|
| `--format, -f` | Output format — see below (default: `console`) |
| `--no-include-segments` | Exclude segments from the diff |
| `--base-url` | SDK polling base URL (default: `https://sdk.launchdarkly.com`) |
| `--help, -h` | Show help |

### Environment Variables

| Variable | Description |
|---|---|
| `LD_BASE_URL` | Alternative to `--base-url` |

## Output Formats

Diagnostic output (progress, summary counts) goes to **stderr**. The diff goes to **stdout**.

### `console` (default)

ANSI-colored human-readable output. Additions in green (`+`), removals in red (`-`), modifications shown as `old => new`. Not JSON — pipe to a terminal.

### `jsonpatch`

RFC 6902 JSON Patch — an array of operations describing what changed. Easy to read and process programmatically.

```json
[
  { "op": "replace", "path": "/flags/my-flag/on", "value": true },
  { "op": "add", "path": "/flags/new-flag", "value": { "..." : "..." } },
  { "op": "remove", "path": "/segments/old-segment" }
]
```

### `delta`

Raw [jsondiffpatch](https://github.com/benjamine/jsondiffpatch) delta format. Compact but requires knowing the delta spec (`[newVal]` = added, `[old, new]` = modified, `[old, 0, 0]` = deleted).

## Examples

```sh
# Human-readable terminal diff
diff-payload.ts sdk-xxx-111 sdk-xxx-222

# RFC 6902 patch, piped to jq
diff-payload.ts sdk-xxx-111 sdk-xxx-222 --format jsonpatch | jq .

# Compare using env vars for keys
diff-payload.ts "$SDK_KEY_STAGING" "$SDK_KEY_PROD" -f console

# Exclude segments
diff-payload.ts sdk-xxx-111 sdk-xxx-222 --no-include-segments

# Save diff for later
diff-payload.ts sdk-xxx-111 sdk-xxx-222 -f jsonpatch > diff.json 2>progress.log
```

## What Gets Stripped

Fields that are instance-specific and create noise when comparing environments are removed before diffing:

| Scope | Stripped fields |
|---|---|
| All objects (recursive) | `_id`, `id` |
| Flags (top-level) | `version`, `flagVersion`, `debugEventsUntilDate`, `salt`, `sel` |
| Segments (top-level) | `version`, `generation`, `salt` |

## Requirements

- [Deno](https://deno.land/) 1.x or later
- SDK keys with access to both environments
