# Get All Audit Log Entries

A script that fetches audit log entries from LaunchDarkly and outputs them as NDJSON (one JSON object per line).

## Features

- Handles pagination automatically
- Retries on network errors and server errors (5xx)
- Respects rate limits using the X-RateLimit-Reset header
- Outputs in NDJSON format for easy processing
- Accepts ISO 8601 date strings or Unix timestamps
- Defaults to last 30 days if no time range specified

## Usage

```bash
deno run --allow-net --allow-env get-all-audit-log-entries.ts [options]
```

### Arguments

All arguments are optional:

- `--before <timestamp>`: Return entries before this timestamp (ISO 8601 string or Unix milliseconds)
- `--after <timestamp>`: Return entries after this timestamp (ISO 8601 string or Unix milliseconds)
- `--q <query>` or `--query <query>`: Full or partial resource name search
- `--spec <spec>`: Resource specifier for filtering

If neither `--before` nor `--after` is specified, the script defaults to fetching entries from the last 30 days.

### Environment Variables

- `LAUNCHDARKLY_API_KEY` or `LD_API_KEY`: Your LaunchDarkly API key (required)

### Examples

```bash
# Get all audit log entries from the last 30 days
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts > audit-log.ndjson

# Get entries after a specific date (ISO 8601)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts --after 2025-01-01T00:00:00Z

# Get entries after a specific timestamp (Unix milliseconds)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts --after 1704067200000

# Search for specific resources
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts --q "production"

# Filter by resource specifier
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts --spec "proj/*:env/production:flag/*"

# Combine multiple filters
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts \
  --after 2025-01-01T00:00:00Z \
  --before 2025-02-01T00:00:00Z \
  --q "flag-key"
```

## Permissions Required

- `--allow-net`: Required to make HTTP requests to the LaunchDarkly API
- `--allow-env`: Required to read the LAUNCHDARKLY_API_KEY environment variable
