# Cleanup Report

Generate a comprehensive report of all live feature flags in a LaunchDarkly project environment, including metadata, targeting information, and variations served.

## Features

- Fetches all live flags from a specified project and environment
- Fetches flag statuses for lifecycle and usage information
- Includes complete flag metadata (maintainer, tags, custom properties, etc.)
- Analyzes which variations are actually being served in the environment
- Reports flag status information (lifecycle status, last requested time, fallback values)
- Outputs data in JSONL (JSON Lines) format for easy processing
- Supports custom LaunchDarkly base URIs (for different regions or instances)
- Includes rate limiting and retry logic for robust API access

## Usage

### Basic Usage

```bash
export LAUNCHDARKLY_API_KEY="your-api-key-here"
# or
export LD_API_KEY="your-api-key-here"

./cleanup-report.ts <project-key> <environment-key>
```

### With Custom Base URI

```bash
export LAUNCHDARKLY_API_KEY="your-api-key-here"
export LAUNCHDARKLY_BASE_URI="https://app.launchdarkly.eu/"
./cleanup-report.ts <project-key> <environment-key>
```

Or pass the base URI as a command-line argument:

```bash
export LAUNCHDARKLY_API_KEY="your-api-key-here"
./cleanup-report.ts <project-key> <environment-key> https://app.launchdarkly.eu/
```

### Output to File

```bash
./cleanup-report.ts my-project production > cleanup-report.jsonl
```

### Process with jq

```bash
# Count total flags
./cleanup-report.ts my-project production | wc -l

# Filter flags ready to archive
./cleanup-report.ts my-project production | jq -c 'select(.stale.readyToArchive == true)'

# Get flags with specific tags
./cleanup-report.ts my-project production | jq -c 'select(.tags | index("temporary"))'

# List flags by maintainer
./cleanup-report.ts my-project production | jq -r '._maintainer.email + ": " + .key'
```

## Required Permissions

This script requires:
- `--allow-net`: To make HTTPS requests to the LaunchDarkly API
- `--allow-env`: To read the `LAUNCHDARKLY_API_KEY` (or `LD_API_KEY`) and `LAUNCHDARKLY_BASE_URI` environment variables

## Environment Variables

### Required

- `LAUNCHDARKLY_API_KEY` or `LD_API_KEY`: Your LaunchDarkly API access token with read permissions for flags and flag statuses (the script checks `LAUNCHDARKLY_API_KEY` first, then falls back to `LD_API_KEY`)

### Optional

- `LAUNCHDARKLY_BASE_URI`: The base URI for the LaunchDarkly API (defaults to `https://app.launchdarkly.com/`)
  - Use `https://app.launchdarkly.eu/` for EU region
  - Use `https://app.launchdarkly.us/` for US Federal region

## Command-Line Arguments

1. `<project-key>` (required): The LaunchDarkly project key
2. `<environment-key>` (required): The environment key within the project
3. `[base-uri]` (optional): Custom LaunchDarkly base URI (overrides `LAUNCHDARKLY_BASE_URI` env variable)

## API Query Parameters

The script automatically applies the following filters and parameters:

- **expand**: `evaluation,codeReferences,archiveChecks` - Includes evaluation details, code references, and archive check information
- **summary**: `0` - Excludes summary statistics to get full details
- **env**: `<environment-key>` - Filters for the specified environment
- **filter**: `filterEnv:<environment-key>,state:live` - Only returns live (non-archived) flags in the specified environment

## Output Format

The script outputs one JSON object per line (JSONL format). Each line represents a single flag with the following structure:

### Output Fields

| Field | Type | Description |
|-------|------|-------------|
| `key` | string | The unique flag key |
| `name` | string | The human-readable flag name |
| `tags` | string[] | Array of tags applied to the flag |
| `temporary` | boolean | Whether the flag is marked as temporary |
| `creationDate` | number | Unix timestamp (milliseconds) of when the flag was created |
| `clientSideAvailability` | object | Client-side SDK availability settings |
| `_maintainer` | object | Information about the flag's maintainer (user) |
| `_maintainerTeam` | object | Information about the flag's maintainer team |
| `stale` | object | Stale flag information with `cleanupId`, `readyForCodeRemoval`, and `readyToArchive` properties |
| `customProperties` | object | Custom properties defined for the flag |
| `description` | string | Flag description |
| `codeReferences` | object | Code references information including repository details, file counts, and latest commit times |
| `environment` | string | The environment key (from input) |
| `lastModified` | number | Unix timestamp (milliseconds) of when the flag's targeting rules were last modified in this environment |
| `lastRequested` | number | Unix timestamp (milliseconds) of when the flag was last requested (from flag status) |
| `status` | string | Flag lifecycle status: "new", "active", "inactive", or "launched" (from flag status) |
| `variations_served` | number[] | Array of unique variation indices currently being served in the environment (from targets, context targets, rules, and fallthrough) |
| `fallback_value` | any | The default/fallback value from flag status |
| `variations` | object[] | Array of all flag variations with their values, names, and descriptions |
| `_summary` | object | Environment summary with counts of prerequisites and variations served by different targeting methods |

### Example Output

```jsonl
{"key":"my-feature","name":"My Feature Flag","tags":["frontend","temporary"],"temporary":true,"creationDate":1702345678901,"clientSideAvailability":{"usingMobileKey":true,"usingEnvironmentId":false},"_maintainer":{"email":"user@example.com","firstName":"Jane","lastName":"Doe"},"_maintainerTeam":{"key":"platform","name":"Platform Team"},"stale":{"cleanupId":null,"readyForCodeRemoval":false,"readyToArchive":false},"customProperties":{"jira":"PROJ-123"},"description":"Controls the new dashboard UI","environment":"production","lastModified":1702456789012,"lastRequested":1702567890123,"status":"active","variations_served":[0,1],"fallback_value":false,"variations":[{"value":false,"name":"Off"},{"value":true,"name":"On"}],"_summary":{"variations":{"0":{"rules":1,"targets":0},"1":{"isFallthrough":true}}}}
```

### Pretty-Printed Example

```json
{
  "key": "my-feature",
  "name": "My Feature Flag",
  "tags": ["frontend", "temporary"],
  "temporary": true,
  "creationDate": 1702345678901,
  "clientSideAvailability": {
    "usingMobileKey": true,
    "usingEnvironmentId": false
  },
  "_maintainer": {
    "email": "user@example.com",
    "firstName": "Jane",
    "lastName": "Doe"
  },
  "_maintainerTeam": {
    "key": "platform",
    "name": "Platform Team"
  },
  "stale": {
    "cleanupId": null,
    "readyForCodeRemoval": false,
    "readyToArchive": false
  },
  "customProperties": {
    "jira": "PROJ-123"
  },
  "description": "Controls the new dashboard UI",
  "codeReferences": {
    "_links": {
      "self": {
        "href": "/api/v2/code-refs/statistics/my-project",
        "type": "application/json"
      }
    },
    "items": [
      {
        "_links": {
          "self": {
            "href": "/api/v2/code-refs/repositories/my-repo",
            "type": "application/json"
          }
        },
        "defaultBranch": "main",
        "enabled": true,
        "fileCount": 2,
        "hunkCount": 3,
        "latestCommitTime": 1760393092000,
        "name": "my-repo",
        "sourceLink": "https://github.com/example/my-repo",
        "type": "github",
        "version": 1
      }
    ]
  },
  "environment": "production",
  "lastModified": 1702456789012,
  "lastRequested": 1702567890123,
  "status": "active",
  "variations_served": [0, 1],
  "fallback_value": false,
  "variations": [
    {"value": false, "name": "Off"},
    {"value": true, "name": "On"}
  ],
  "_summary": {
    "variations": {
      "0": {"rules": 1, "targets": 0},
      "1": {"isFallthrough": true}
    }
  }
}
```

## Understanding variations_served

The `variations_served` field contains an array of variation indices that are currently being served to users in the specified environment. This includes variations served through:

- **Targets**: Individual user targeting
- **Context Targets**: Context-based targeting
- **Rules**: Percentage rollouts and rule-based targeting
- **Fallthrough**: The default variation when no rules match

This field is useful for identifying:
- Which variations are actively in use
- Variations that can be safely removed
- Whether a flag is effectively serving only one variation (candidate for cleanup)

## Use Cases

### Priority Flag Cleanup with Sorting

Find flags ready for cleanup, sorted by priority:

```bash
# Find flags serving one variation that are ready to archive or ready for code removal
# Sorted by: readyToArchive → readyForCodeRemoval → modified >30 days → lastModified → creationDate
./cleanup-report.ts my-project production | \
jq -sc '
  map(select(
    ((.variations_served | length) == 1) or
    ((.stale.readyForCodeRemoval == true) or (.stale.readyToArchive == true))
  ))
  | sort_by([
    (.stale.readyToArchive != true),
    (.stale.readyForCodeRemoval != true),
    ((.lastModified // 0) > (now * 1000 - 2592000000) | not),
    -(.lastModified // 0),
    -(.creationDate // 0)
  ])
  | .[]
'
```

This outputs JSONL (one flag per line) sorted by:
1. Flags with `readyToArchive = true` (highest priority)
2. Flags with `readyForCodeRemoval = true`
3. Flags last modified > 30 days ago
4. Most recently modified flags
5. Most recently created flags

### CSV Export for Developer Outreach

Generate a CSV for contacting developers about cleaning up their old flags:

```bash
./cleanup-report.ts my-project production | \
jq -rsc '
  # Filter and sort like before
  map(select(
    ((.variations_served | length) == 1) or
    ((.stale.readyForCodeRemoval == true) or (.stale.readyToArchive == true))
  ))
  | sort_by([
    (.stale.readyToArchive != true),
    (.stale.readyForCodeRemoval != true),
    ((.lastModified // 0) > (now * 1000 - 2592000000) | not),
    -(.lastModified // 0),
    -(.creationDate // 0)
  ])
  # Output CSV header
  | ["Flag Key", "Flag Name", "Maintainer Email", "Maintainer Name", "Ready to Archive", "Ready for Code Removal", "Repositories", "Total Files", "Latest Code Ref", "Last Modified", "Created"] as $header
  # Transform to CSV rows
  | map([
      .key,
      (.name // ""),
      (._maintainer.email // ""),
      ((._maintainer.firstName // "") + " " + (._maintainer.lastName // "") | gsub("^[[:space:]]+|[[:space:]]+$"; "")),
      (.stale.readyToArchive // false),
      (.stale.readyForCodeRemoval // false),
      (if .codeReferences.items then (.codeReferences.items | map(.name) | join("; ")) else "" end),
      (if .codeReferences.items then (.codeReferences.items | map(.fileCount // 0) | add) else 0 end),
      (if .codeReferences.items then (.codeReferences.items | map(.latestCommitTime // 0) | max | if . > 0 then (. / 1000 | strftime("%Y-%m-%d")) else "" end) else "" end),
      (if .lastModified then (.lastModified / 1000 | strftime("%Y-%m-%d")) else "" end),
      (if .creationDate then (.creationDate / 1000 | strftime("%Y-%m-%d")) else "" end)
    ])
  | [$header] + .
  | .[]
  | @csv
' > flag-cleanup.csv
```

This CSV includes:
- **Flag Key** - The flag identifier
- **Flag Name** - Human-readable name
- **Maintainer Email** - Who to contact about cleanup
- **Maintainer Name** - Full name of the maintainer
- **Ready to Archive** - Boolean indicating if flag is ready to archive
- **Ready for Code Removal** - Boolean indicating if code can be removed
- **Repositories** - Semicolon-separated list of repos where flag is referenced
- **Total Files** - Number of files containing references to this flag
- **Latest Code Ref** - Most recent commit time across all repos
- **Last Modified** - When flag targeting was last changed
- **Created** - When flag was created

The output is sorted by priority (readyToArchive → readyForCodeRemoval → age → recency) to help prioritize cleanup efforts.

### Flag Cleanup Analysis

Identify flags that are candidates for removal:

```bash
# Find flags serving only one variation
./cleanup-report.ts my-project production | \
  jq -c 'select((.variations_served | length) == 1)'

# Find flags ready to archive
./cleanup-report.ts my-project production | \
  jq -c 'select(.stale.readyToArchive == true)'

# Find temporary flags older than 90 days
./cleanup-report.ts my-project production | \
  jq -c --arg cutoff "$(date -v-90d +%s)000" \
  'select(.temporary == true and (.creationDate | tonumber) < ($cutoff | tonumber))'
```

### Maintainer Analysis

```bash
# Group flags by maintainer
./cleanup-report.ts my-project production | \
  jq -r '._maintainer.email' | sort | uniq -c | sort -rn

# Find flags without maintainers
./cleanup-report.ts my-project production | \
  jq -c 'select(._maintainer == null or ._maintainer == {})'
```

### Tag Analysis

```bash
# Count flags by tag
./cleanup-report.ts my-project production | \
  jq -r '.tags[]?' | sort | uniq -c | sort -rn

# Find untagged flags
./cleanup-report.ts my-project production | \
  jq -c 'select(.tags == null or (.tags | length) == 0)'
```

### Code References Analysis

```bash
# Find flags with no code references
./cleanup-report.ts my-project production | \
  jq -c 'select(.codeReferences.items == null or (.codeReferences.items | length) == 0)'

# Find flags with code references older than 90 days
./cleanup-report.ts my-project production | \
  jq -c --arg cutoff "$(date -v-90d +%s)000" \
  'select(.codeReferences.items[]?.latestCommitTime < ($cutoff | tonumber))'

# Count code references per repository
./cleanup-report.ts my-project production | \
  jq -r '.codeReferences.items[]? | "\(.name): \(.fileCount) files, \(.hunkCount) hunks"'
```

## Error Handling

The script includes built-in retry logic for:
- Rate limiting (429 responses)
- Server errors (5xx responses)
- Network errors

If the script encounters an unrecoverable error, it will:
1. Print an error message to stderr
2. Exit with code 1

## Exit Codes

- `0`: Success
- `1`: Error (missing required arguments, API errors, etc.)

## Notes

- The script only fetches **live** (non-archived) flags by default
- All dates are returned as Unix timestamps in milliseconds
- Flags are returned in the order provided by the API (not sorted by default)
- Rate limiting is automatically handled with exponential backoff
- Each flag is output as a complete JSON object on a single line (JSONL format)
