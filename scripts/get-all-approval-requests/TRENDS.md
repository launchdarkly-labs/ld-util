# Approval Trends Analysis

TypeScript tool to analyze approval request metrics over time with interactive HTML visualizations or JSON output.

## Usage

### Basic Usage

```bash
# Fetch data (optionally with expanded fields for project/environment breakdown)
deno run --allow-net --allow-env get-all-approval-requests.ts \
  --expand project --expand environments > approvals.json

# Generate HTML report (default)
deno run --allow-read analyze-trends.ts --input approvals.json > trends.html

# Or pipe directly from stdin
cat approvals.json | deno run --allow-read analyze-trends.ts > trends.html

# Generate JSON output
deno run --allow-read analyze-trends.ts -i approvals.json -f json > metrics.json
```

## Command Line Options

- `--input, -i <path>` - Input file path, or "-" for stdin (default: stdin)
- `--format, -f <format>` - Output format: "json" or "html" (default: html)
- `--help, -h` - Show help message

## Output Formats

### HTML Output (default)

Generates an interactive HTML report with:
- **Time series bar charts** showing approval and apply times over time
- **Request volume charts** by month
- **Project/Environment breakdowns** (when data includes expanded fields)
  - Each project/env gets its own collapsible section with trend charts
  - Shows top 15 project/environment combinations by request volume
- **Detailed metrics table** with human-readable time formatting
- **Horizontal scrolling** for reports with many months
- **Interactive tooltips** on hover

### JSON Output

Structured JSON with monthly metrics:

```json
[
  {
    "month": "2024-12",
    "avgTimeToApproveMs": 120000,
    "avgTimeToApplyMs": 5000,
    "totalRequests": 10,
    "approvedCount": 8,
    "completedCount": 8,
    "byProjectEnv": [
      {
        "projectKey": "term-demo",
        "projectName": "Term Demo",
        "envKey": "production",
        "envName": "Production",
        "avgTimeToApproveMs": 120000,
        "avgTimeToApplyMs": 5000,
        "totalRequests": 7,
        "approvedCount": 7,
        "completedCount": 7
      }
    ]
  }
]
```

## Features

- ✅ Analyze all historical data (no time filters)
- ✅ Group by month (YYYY-MM format)
- ✅ Calculate average approval and apply times
- ✅ Count requests by status (approved, completed)
- ✅ Automatic project/environment breakdown when data is expanded
- ✅ Interactive HTML visualizations with scrollable charts
- ✅ JSON output for programmatic processing
- ✅ Stdin/stdout support for Unix pipelines
- ✅ Self-contained HTML (no external dependencies)

## Examples

### Complete Pipeline

```bash
# Fetch, analyze, and view in one go
deno run --allow-net --allow-env get-all-approval-requests.ts \
  --expand project --expand environments | \
  deno run --allow-read analyze-trends.ts > trends.html && \
  open trends.html
```

### JSON Processing

```bash
# Get JSON metrics and extract specific month
deno run --allow-read analyze-trends.ts -i approvals.json -f json | \
  jq '.[] | select(.month == "2024-12")'

# Calculate total requests across all months
deno run --allow-read analyze-trends.ts -i approvals.json -f json | \
  jq '[.[].totalRequests] | add'

# Find month with longest average approval time
deno run --allow-read analyze-trends.ts -i approvals.json -f json | \
  jq 'max_by(.avgTimeToApproveMs) | {month, avgTimeToApproveMs}'
```

### Filtering by Environment

```bash
# Extract production metrics from JSON output
deno run --allow-read analyze-trends.ts -i approvals.json -f json | \
  jq '[.[] | . + {byProjectEnv: (.byProjectEnv | map(select(.envKey == "production")))}]'
```
