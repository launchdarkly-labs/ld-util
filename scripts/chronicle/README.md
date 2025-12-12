# Chronicle

Generate a Spotify Wrapped-style yearly report from LaunchDarkly audit logs. Chronicle analyzes your activity and provides personal statistics, collaboration insights, and comparative rankings.

## Features

- **Personal Statistics**: Track flags created, archived, updated, projects worked on, and peak activity
- **Collaboration Insights**: Discover who you work with most on feature flags
- **Comparative Rankings**: See how you stack up against other team members
- **Dual Input Modes**: Fetch from API or read from local JSONL file
- **Automatic Identity Detection**: Uses caller identity API to determine current user

## Usage

```bash
deno run --allow-net --allow-env --allow-read chronicle.ts [options]
```

### Options

- `--input <file>`: Read audit log from JSONL file instead of fetching from API
- `--year <year>`: Specify year for report (default: current year)
- `--help, -h`: Show help message

### Environment Variables

- `LAUNCHDARKLY_API_KEY` or `LD_API_KEY`: Your LaunchDarkly API key (required)

## Examples

### Fetch from API (Current Year)

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts
```

### Read from Local File

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts --input audit-log.json
```

### Generate Report for Specific Year

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts --year 2024
```

### Save Report to File

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts > my-2025-report.json
```

## Output Format

The script outputs a JSON report with the following structure:

```json
{
  "user": {
    "memberId": "abc123",
    "email": "you@example.com",
    "firstName": "Jane",
    "lastName": "Doe"
  },
  "year": 2025,
  "stats": {
    "flagsCreated": 42,
    "flagsArchived": 5,
    "flagUpdates": 128,
    "projectsWorkedOn": ["project-a", "project-b"],
    "totalProjects": 2,
    "peakActivity": {
      "month": "March",
      "count": 87,
      "day": "2025-03-15",
      "dayCount": 23
    }
  },
  "collaborators": [
    {
      "memberId": "xyz789",
      "email": "teammate@example.com",
      "name": "John Smith",
      "sharedFlags": 15
    }
  ],
  "rankings": {
    "flagsCreated": {
      "rank": 3,
      "total": 15,
      "percentile": 80,
      "above": {
        "memberId": "def456",
        "name": "Top Performer",
        "count": 58
      },
      "below": {
        "memberId": "ghi789",
        "name": "Another Teammate",
        "count": 38
      },
      "topCreators": [
        {
          "memberId": "...",
          "name": "Leader",
          "count": 102
        }
      ]
    }
  }
}
```

## Report Fields

### User
- Basic information about the user the report is for

### Stats
- **flagsCreated**: Number of new flags created
- **flagsArchived**: Number of flags archived or deleted
- **flagUpdates**: Number of flag modifications (targeting, rules, etc.)
- **experimentsCreated**: Number of experiments created
- **segmentsCreated**: Number of segments created
- **approvals**: Approval workflow participation
  - **created**: Approval requests you created
  - **reviewed**: Approval requests you reviewed
  - **applied**: Approval requests you applied
- **releasePipelines**: Release pipeline activity
  - **created**: Release pipelines you created
  - **used**: Times you used release pipelines
- **integrationsCreated**: Number of integrations created
- **guardedRollouts**: Number of guarded/measured rollouts
- **projectsWorkedOn**: List of project keys the user contributed to
- **totalProjects**: Count of unique projects
- **peakActivity**: When the user was most active
  - **month**: Most active month name and count
  - **day**: Most active single day and count
  - **hour**: Most active hour (0-23 UTC) and count
- **remediation**: Flag incident remediation stats (null if no incidents)
  - **fastestSeconds**: Fastest time to turn a flag back on after turning it off
  - **fastestFlag**: Name of the flag with fastest remediation
  - **totalIncidents**: Number of times you turned flags off then back on
  - **averageSeconds**: Average time to remediate
- **insights**: Interesting patterns about your work style
  - **longestStreak**: Longest consecutive days with activity
  - **weekendWarrior**: Whether you work on weekends frequently (>50 actions)
  - **nightOwl**: Whether you work late nights (>20% activity 10 PM - 4 AM)
  - **earlyBird**: Whether you work early mornings (>15% activity 5 AM - 8 AM)
  - **cleanupCrew**: Whether you archive >50% of flags you create
  - **topEnvironment**: Environment you work in most
  - **productionChanges**: Number of production environment changes

### Collaborators
- List of team members who worked on the same flags as you
- Sorted by number of shared flag modifications
- Shows top 10 collaborators

### Rankings
- **rank**: Your position among all team members (1 is best)
- **total**: Total number of members who created flags
- **percentile**: Your percentile ranking (0-100, higher is better)
- **above**: The person ranked directly above you
- **below**: The person ranked directly below you
- **topCreators**: Top 5 flag creators in the account

## How It Works

1. **Identity**: Calls `/api/v2/caller-identity` to determine current user
2. **Member Details**: Fetches user information from `/api/v2/members/:id`
3. **Audit Logs**: Either reads from file or fetches from API for specified year
4. **Analysis**: Processes entries to calculate all statistics
   - Flags, experiments, segments, approvals, pipelines
   - Guarded rollouts and remediation tracking
   - Time-based patterns and work style insights
5. **Collaboration**: Finds other members who modified the same flags
6. **Rankings**: Compares your activity against all team members

## Permissions Required

- `--allow-net`: Make HTTP requests to LaunchDarkly API
- `--allow-env`: Read API key environment variable
- `--allow-read`: Read audit log file (if using `--input`)

## Tips

### Creating an Audit Log File

You can use the `get-all-audit-log-entries` script to create an audit log file:

```bash
# Export full year of audit logs
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env \
  ../get-all-audit-log-entries/get-all-audit-log-entries.ts \
  --after "2025-01-01T00:00:00Z" \
  --before "2025-12-31T23:59:59Z" \
  > audit-log-2025.json

# Then generate your Chronicle report
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read \
  chronicle.ts --input audit-log-2025.json
```

### Performance

- **API Mode**: Fetches only the data you need for the specified year
- **File Mode**: Faster for repeated analysis, but requires pre-fetching audit logs
- Large audit logs are processed in a streaming fashion to minimize memory usage

## Troubleshooting

### "Error: LAUNCHDARKLY_API_KEY or LD_API_KEY environment variable is required"

Set your API key as an environment variable:
```bash
export LAUNCHDARKLY_API_KEY=your-api-key-here
```

### "Failed to get caller identity"

Ensure your API key has the correct permissions to access the audit log API.

### Empty or Missing Stats

If certain stats are 0 or missing:
- Check that the year parameter matches when your audit logs exist
- Verify that the audit log file contains entries for the user
- Some stats may be 0 if you didn't perform those actions during the year
