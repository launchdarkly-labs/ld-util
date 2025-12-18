# Get All Approval Requests

A script that fetches approval requests from LaunchDarkly and outputs them as NDJSON (one JSON object per line).

## Features

- Handles pagination automatically
- **Parallel fetching** for faster downloads (optional)
- Real-time progress reporting with percentage completion
- Automatic deduplication across parallel requests
- Retries on network errors and server errors (5xx)
- Respects rate limits using the X-RateLimit-Reset header
- Outputs in NDJSON format for easy processing
- Support for all LaunchDarkly approval request filters
- Expandable responses for related resources

## Usage

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts [options]
```

### Filter Arguments

All filter arguments are optional and can be combined:

- `--filter-notify-member-id <id>`: Filter by member ID assigned to approval (can be specified multiple times)
- `--filter-requestor-id <id>`: Filter by requester's member ID
- `--filter-resource-id <id>`: Filter by resource identifier
- `--filter-resource-kind <kind>`: Filter by resource type (`flag`, `segment`, or `aiConfig`)
- `--filter-review-status <status>`: Filter by review status (`approved`, `declined`, or `pending`) (can be specified multiple times)
- `--filter-status <status>`: Filter by approval status (`pending`, `scheduled`, `failed`, or `completed`) (can be specified multiple times)

### Other Arguments

- `--expand <field>`: Include additional details in response (`flag`, `project`, `environments`) (can be specified multiple times)
- `--parallel <num>`: Number of parallel requests to use (default: sequential, example: 10)
- `--base-url <url>`: Custom base URL for LaunchDarkly API (default: https://app.launchdarkly.com)

### Environment Variables

- `LAUNCHDARKLY_API_KEY` or `LD_API_KEY`: Your LaunchDarkly API key (required)

### Examples

```bash
# Get all approval requests
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts > approvals.ndjson

# Filter by review status (pending approvals)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --filter-review-status pending

# Filter by multiple review statuses
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --filter-review-status pending \
  --filter-review-status approved

# Filter by resource type (flags only)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --filter-resource-kind flag

# Filter by assigned member (multiple members)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --filter-notify-member-id 507f1f77bcf86cd799439011 \
  --filter-notify-member-id 507f1f77bcf86cd799439012

# Include expanded flag details
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --expand flag \
  --expand project

# Combine multiple filters
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --filter-resource-kind flag \
  --filter-review-status pending \
  --filter-requestor-id 507f1f77bcf86cd799439011

# Use parallel fetching for faster downloads (10 parallel requests)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --parallel 10 > approvals.ndjson

# Parallel fetching with progress to stderr, data to stdout
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env get-all-approval-requests.ts \
  --parallel 10 > approvals.ndjson
# Progress shows on screen: [70%] Retrieved 150 entries...
```

## Parallel Fetching

When using `--parallel <num>`, the script fetches approval requests in parallel chunks:

- **Faster downloads**: 5-10x speedup for large datasets
- **Real-time progress**: Shows percentage and entry count as data streams in
- **Automatic deduplication**: Removes duplicate entries at chunk boundaries
- **Progress to stderr**: Progress messages don't interfere with NDJSON output to stdout

**Example output:**
```
Fetching approval requests in 10 parallel chunks...
[10%] Retrieved 50 entries (1/10 requests complete)
[30%] Retrieved 150 entries (3/10 requests complete)
[70%] Retrieved 350 entries (7/10 requests complete)
[100%] Complete: 500 entries retrieved
```

**Recommended values:**
- Use `--parallel 10` for large datasets (thousands of approval requests)
- Use `--parallel 5` for medium datasets (hundreds of approval requests)
- Omit for smaller datasets (sequential is fine)

## Filter Examples

### By Review Status

```bash
# Get all pending approvals
--filter-review-status pending

# Get approved and declined approvals
--filter-review-status approved --filter-review-status declined
```

### By Approval Status

```bash
# Get completed approvals
--filter-status completed

# Get pending and scheduled approvals
--filter-status pending --filter-status scheduled
```

### By Resource

```bash
# Get approvals for a specific flag
--filter-resource-id "proj/my-project:env/production:flag/my-flag"

# Get all flag approvals
--filter-resource-kind flag
```

### By People

```bash
# Get approvals assigned to specific members
--filter-notify-member-id 507f1f77bcf86cd799439011 \
--filter-notify-member-id 507f1f77bcf86cd799439012

# Get approvals requested by a specific member
--filter-requestor-id 507f1f77bcf86cd799439011
```

## Permissions Required

- `--allow-net`: Required to make HTTP requests to the LaunchDarkly API
- `--allow-env`: Required to read the LAUNCHDARKLY_API_KEY environment variable

## Output Format

The script outputs one JSON object per line (NDJSON format):

```json
{"_id":"63f7b8c0d5e4f3001a123456","_links":{"self":{"href":"/api/v2/approval-requests/63f7b8c0d5e4f3001a123456"}},"status":"pending","reviewStatus":"pending",...}
{"_id":"63f7b8c0d5e4f3001a123457","_links":{"self":{"href":"/api/v2/approval-requests/63f7b8c0d5e4f3001a123457"}},"status":"completed","reviewStatus":"approved",...}
```

This format is ideal for streaming processing and can be easily parsed line-by-line or imported into tools like `jq`.

## Processing with jq

You can pipe the NDJSON output to `jq` for analysis and calculations.

### Calculate Average Approval Times

Calculate the average time between request creation and approval:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts | \
jq -s '
  map(
    select(.reviewStatus == "approved" and .allReviews != null) |
    {
      timeToApprove: (
        (.allReviews[] | select(.kind == "approve") | .creationDate) - .creationDate
      )
    }
  ) |
  {
    avgTimeToApproveMs: (map(.timeToApprove) | add / length),
    avgTimeToApproveHours: (map(.timeToApprove) | add / length / 1000 / 60 / 60),
    avgTimeToApproveDays: (map(.timeToApprove) | add / length / 1000 / 60 / 60 / 24),
    count: length
  }
'
```

Calculate the average time between approval and when changes were applied:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts | \
jq -s '
  map(
    select(.status == "completed" and .reviewStatus == "approved" and .appliedDate != null and .allReviews != null) |
    {
      timeToApply: (
        .appliedDate - (.allReviews[] | select(.kind == "approve") | .creationDate)
      )
    }
  ) |
  {
    avgTimeToApplyMs: (map(.timeToApply) | add / length),
    avgTimeToApplyHours: (map(.timeToApply) | add / length / 1000 / 60 / 60),
    avgTimeToApplyDays: (map(.timeToApply) | add / length / 1000 / 60 / 60 / 24),
    count: length
  }
'
```

Calculate both metrics in one pass:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts | \
jq -s '
  {
    timeToApprove: map(
      select(.reviewStatus == "approved" and .allReviews != null) |
      (.allReviews[] | select(.kind == "approve") | .creationDate) - .creationDate
    ),
    timeToApply: map(
      select(.status == "completed" and .reviewStatus == "approved" and .appliedDate != null and .allReviews != null) |
      .appliedDate - (.allReviews[] | select(.kind == "approve") | .creationDate)
    )
  } |
  {
    avgTimeToApprove: {
      hours: (.timeToApprove | add / length / 1000 / 60 / 60),
      days: (.timeToApprove | add / length / 1000 / 60 / 60 / 24),
      count: (.timeToApprove | length)
    },
    avgTimeToApply: {
      hours: (.timeToApply | add / length / 1000 / 60 / 60),
      days: (.timeToApply | add / length / 1000 / 60 / 60 / 24),
      count: (.timeToApply | length)
    }
  }
'
```

### Break Down Metrics by Project/Environment

Calculate average approval times grouped by project:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts --expand project | \
jq -s 'group_by(.project.key) | map({
  project: .[0].project.name,
  projectKey: .[0].project.key,
  avgTimeToApproveHours: (
    map(
      select(.reviewStatus == "approved" and .allReviews != null) |
      ((.allReviews[] | select(.kind == "approve") | .creationDate) - .creationDate)
    ) |
    if length > 0 then add / length / 1000 / 60 / 60 else null end
  ),
  avgTimeToApplyHours: (
    map(
      select(.status == "completed" and .reviewStatus == "approved" and .appliedDate != null and .allReviews != null) |
      .appliedDate - (.allReviews[] | select(.kind == "approve") | .creationDate)
    ) |
    if length > 0 then add / length / 1000 / 60 / 60 else null end
  ),
  totalRequests: length,
  approvedCount: map(select(.reviewStatus == "approved")) | length,
  completedCount: map(select(.status == "completed")) | length
}) | sort_by(-.totalRequests)'
```

Calculate average approval times grouped by environment:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts --expand environments | \
jq -s 'map(select(.environments != null) | . as $req | .environments[] | {
  env: .,
  req: $req
}) | group_by(.env.key) | map({
  environment: .[0].env.name,
  envKey: .[0].env.key,
  avgTimeToApproveHours: (
    map(.req | select(.reviewStatus == "approved" and .allReviews != null) |
      ((.allReviews[] | select(.kind == "approve") | .creationDate) - .creationDate)
    ) |
    if length > 0 then add / length / 1000 / 60 / 60 else null end
  ),
  avgTimeToApplyHours: (
    map(.req | select(.status == "completed" and .reviewStatus == "approved" and .appliedDate != null and .allReviews != null) |
      .appliedDate - (.allReviews[] | select(.kind == "approve") | .creationDate)
    ) |
    if length > 0 then add / length / 1000 / 60 / 60 else null end
  ),
  totalRequests: length
}) | sort_by(-.totalRequests)'
```

Calculate metrics grouped by both project and environment:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts --expand project --expand environments | \
jq -s 'map(select(.environments != null and .project != null) | . as $req | .environments[] | {
  project: $req.project.key,
  projectName: $req.project.name,
  env: .key,
  envName: .name,
  req: $req
}) | group_by(.project + "/" + .env) | map({
  project: .[0].projectName,
  environment: .[0].envName,
  key: .[0].project + "/" + .[0].env,
  avgTimeToApproveHours: (
    map(.req | select(.reviewStatus == "approved" and .allReviews != null) |
      ((.allReviews[] | select(.kind == "approve") | .creationDate) - .creationDate)
    ) |
    if length > 0 then add / length / 1000 / 60 / 60 else null end
  ),
  avgTimeToApplyHours: (
    map(.req | select(.status == "completed" and .reviewStatus == "approved" and .appliedDate != null and .allReviews != null) |
      .appliedDate - (.allReviews[] | select(.kind == "approve") | .creationDate)
    ) |
    if length > 0 then add / length / 1000 / 60 / 60 else null end
  ),
  totalRequests: length
}) | sort_by(-.totalRequests)'
```

### Other jq Examples

Count approvals by status:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts | \
jq -s 'group_by(.reviewStatus) | map({status: .[0].reviewStatus, count: length})'
```

Find the longest pending approval:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts | \
jq -s 'map(select(.reviewStatus == "pending")) | max_by((now * 1000) - .creationDate) | {id: ._id, age_hours: ((now * 1000) - .creationDate) / 1000 / 60 / 60}'
```

List requestors by approval count:

```bash
deno run --allow-net --allow-env get-all-approval-requests.ts | \
jq -s 'group_by(.requestorId) | map({requestor: .[0].requestorId, count: length}) | sort_by(-.count)'
```
