# Get All Flag Statuses

A script that fetches all feature flag statuses from a LaunchDarkly project and environment and outputs them as NDJSON (one JSON object per line).

## Features

- Handles pagination automatically
- Retries on network errors and server errors (5xx)
- Respects rate limits using the X-RateLimit-Reset header
- Outputs in NDJSON format for easy processing

## Usage

```bash
deno run --allow-net --allow-env get-all-flag-statuses.ts <project-key> <environment-key>
```

Replace `<project-key>` and `<environment-key>` with the actual keys of your LaunchDarkly project and environment.

### Arguments

- `project-key`: The LaunchDarkly project key to fetch flag statuses from
- `environment-key`: The LaunchDarkly environment key to fetch flag statuses from

### Environment Variables

- `LD_API_KEY`: Your LaunchDarkly API key (required)

### Example

```bash
LD_API_KEY=api-123 deno run --allow-net --allow-env get-all-flag-statuses.ts my-project production > flag-statuses.ndjson
```

## Permissions Required

- `--allow-net`: Required to make HTTP requests to the LaunchDarkly API
- `--allow-env`: Required to read the LD_API_KEY environment variable

