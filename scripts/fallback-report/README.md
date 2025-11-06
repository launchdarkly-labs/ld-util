# Fallback Report

A script that analyzes feature flag fallback values to detect stale or incorrect configurations. It compares the `default` property (fallback value) reported in flag statuses against the expected values based on flag configuration.

## Features

- Detects flags with missing fallback values
- Identifies flags where fallback values don't match expected variations
- Warns when flags serve multiple variations (since no single fallback can serve all users correctly)
- Categorizes issues by severity (critical, warning, unknown)
- Handles complex flag configurations including rollouts, rules, targeting, and prerequisites
- Shows which users/rules/targets are impacted by incorrect fallbacks
- Provides detailed variation serving information for multi-variation flags
- Supports both JSON and Markdown output formats

## Usage

```bash
deno run --allow-net --allow-env fallback-report.ts <project-key> <environment-key> [--format json|markdown]
```

Replace `<project-key>` and `<environment-key>` with the actual keys of your LaunchDarkly project and environment.

### Arguments

- `project-key`: The LaunchDarkly project key to analyze
- `environment-key`: The LaunchDarkly environment key to analyze
- `--format`: Output format - `json` (default) or `markdown`
- `--filter-tags`: (Optional) Comma-separated list of tags to filter flags by

### Environment Variables

- `LD_API_KEY`: Your LaunchDarkly API key (required)

### Examples

```bash
# JSON output (default)
LD_API_KEY=api-123 deno run --allow-net --allow-env fallback-report.ts my-project production

# Markdown output
LD_API_KEY=api-123 deno run --allow-net --allow-env fallback-report.ts my-project production --format markdown
```

## How It Works

The script analyzes flags and reports issues in three categories:

### 1. Missing Fallback Values (Unknown)
Flags where the `default` property is not reported in the flag status. This indicates an unknown state.

### 2. Critical Issues
Flags that are ON where all rules, rollouts (100%), fallthrough, and targets serve the same single variation, but the fallback value doesn't match that variation. This means **all users** would receive an unexpected variation.

### 3. Warnings
Flags that serve multiple variations will always generate a warning, since there's no way to choose a fallback that doesn't impact some users. This includes:

- **Multiple variations served**: Flags that serve different variations to different users (via rules, targets, or rollouts). Even if the fallback matches one variation, users expecting other variations will be impacted.
- **Fallback mismatch**: Flags where the fallback doesn't match the expected value (when serving a single variation).
- **Prerequisite warnings**: Flags with prerequisites that serve multiple variations or are missing, which could cause unexpected behavior.

## Output

The script outputs detailed information for each issue:

### JSON Format (default)
- Summary statistics (total issues, counts by severity)
- For each issue:
  - Flag key and name
  - Severity (critical, warning, unknown)
  - Reason for the issue
  - Fallback value and expected value (if applicable)
  - Recommended fallback value(s) with explanation
  - Impacted users/rules/targets (which specific users would receive incorrect values)
  - Variation serving details (for multi-variation flags, shows how each variation is served)
  - Environment state (ON/OFF)

### Markdown Format
Human-readable report with:
- Header with project, environment, and generation timestamp
- Summary section
- Issues grouped by severity (Critical, Warnings, Unknown/Missing Data)
- Detailed information for each flag including variations served and impacted users

### Exit Code
- `0`: Script executed successfully (regardless of whether issues were found)
- `1`: Script execution failed (e.g., missing API key, invalid arguments, API errors)

## Prerequisites

The script analyzes prerequisite flags to determine expected fallback behavior:
- If a prerequisite flag is OFF, the dependent flag should serve its off variation
- If a prerequisite flag serves multiple variations, a warning is generated since the prerequisite check may fail unpredictably
- Missing prerequisite flags generate warnings

## Variation Serving Details

For flags serving multiple variations, the report includes:
- Which variations are served (with their values)
- How each variation is served (via fallthrough, rules, targets, or context targets)
- Which specific rules/targets serve which variations
- Rollout weights (if applicable)

This helps understand which users would be impacted by an incorrect fallback value.

## Permissions Required

- `--allow-net`: Required to make HTTP requests to the LaunchDarkly API
- `--allow-env`: Required to read the LD_API_KEY environment variable
