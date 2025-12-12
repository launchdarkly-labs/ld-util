# Get All Audit Log Entries

A script that fetches audit log entries from LaunchDarkly and outputs them as NDJSON (one JSON object per line).

## Features

- Handles pagination automatically
- **Parallel fetching** for faster downloads (optional)
- Real-time progress reporting with percentage completion
- Automatic deduplication across parallel requests
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
- `--parallel <num>`: Number of parallel requests to use (default: sequential, example: 10)
- `--sorted`: Sort entries by date when using `--parallel` (disables streaming, buffers all entries)

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

# Use parallel fetching for faster downloads (10 parallel requests)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts \
  --after 2025-01-01 --before 2025-12-31 \
  --parallel 10 > audit-log.ndjson

# Parallel fetching with progress to stderr, data to stdout
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts \
  --after 2025-01-01 --before 2025-12-31 \
  --parallel 10 > audit-log.ndjson
# Progress shows on screen: [70%] Retrieved 10,000 entries...

# Sorted output (buffers all entries, then sorts by date)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-audit-log-entries.ts \
  --after 2025-01-01 --before 2025-12-31 \
  --parallel 10 --sorted > audit-log-sorted.ndjson
```

## Parallel Fetching

When using `--parallel <num>`, the script splits the time range into chunks and fetches them concurrently:

- **Faster downloads**: 5-10x speedup for large date ranges
- **Real-time progress**: Shows percentage and entry count as data streams in
- **Automatic deduplication**: Removes duplicate entries at chunk boundaries
- **Progress to stderr**: Progress messages don't interfere with NDJSON output to stdout
- **Out-of-order by default**: Entries are returned as soon as they're fetched (fastest)
- **Sorted option**: Add `--sorted` to buffer and sort all entries before output (slower, uses more memory)

**Example output:**
```
Fetching audit logs from 2025-01-01T00:00:00.000Z to 2025-12-31T00:00:00.000Z...
[10%] Retrieved 1,500 entries (1/10 requests complete)
[30%] Retrieved 4,200 entries (3/10 requests complete)
[70%] Retrieved 10,429 entries (7/10 requests complete)
[100%] Complete: 14,843 entries retrieved
```

**Recommended values:**
- Use `--parallel 10` for year-long ranges
- Use `--parallel 5` for month-long ranges
- Omit for smaller ranges (sequential is fine)

## Permissions Required

- `--allow-net`: Required to make HTTP requests to the LaunchDarkly API
- `--allow-env`: Required to read the LAUNCHDARKLY_API_KEY environment variable
