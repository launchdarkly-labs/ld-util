# ld-toolkit
Assorted utilities and scripts for LaunchDarkly


## Scripts
Standalone scripts and utilities for LaunchDarkly.

### Analysis & Reporting
- [chronicle](./scripts/chronicle/README.md): Generate a Spotify Wrapped-style yearly report from LaunchDarkly audit logs with personal statistics, collaboration insights, achievements, and team rankings. Supports both JSON and interactive HTML output.
- [fallback-report](./scripts/fallback-report/README.md): Analyze feature flag fallback values to detect stale or incorrect configurations. Identifies flags with missing or mismatched fallback values and categorizes issues by severity.

### Data Export
- [get-all-approval-requests](./scripts/get-all-approval-requests/README.md): Fetch all approval requests from LaunchDarkly and output them as NDJSON. Supports filtering by member, status, resource, and parallel fetching for faster downloads.
- [get-all-audit-log-entries](./scripts/get-all-audit-log-entries/README.md): Fetch audit log entries from LaunchDarkly and output them as NDJSON. Supports time-based filtering, search queries, and parallel fetching for faster downloads.
- [get-all-flags](./scripts/get-all-flags/README.md): Fetch all feature flags from a LaunchDarkly project and output them as NDJSON. Handles pagination and rate limiting.
- [get-all-flag-statuses](./scripts/get-all-flag-statuses/README.md): Fetch all feature flag statuses from a LaunchDarkly project and environment and output them as NDJSON. Handles pagination and rate limiting.

### Maintenance & Utilities
- [changes-by-context-key](./scripts/changes-by-context-key/README.md): Given a context kind and context key, find all changes to individual targeting that affect the context.
- [clear-prereqs](./scripts/clear-prereqs/README.md): Given a feature flag, find all dependent flags and remove prerequisite rules. Useful when you need to remove a flag that is used as a prerequisite.
- [generate-admin-custom-role](./scripts/generate-admin-custom-role/README.md): Generate a custom role policy with admin-level permissions by scraping the LaunchDarkly documentation.

