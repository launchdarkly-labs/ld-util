# Chronicle

Generate a Spotify Wrapped-style yearly report from LaunchDarkly audit logs. Chronicle analyzes your activity and provides personal statistics, collaboration insights, and comparative rankings.

## Features

- **Personal Statistics**: Track flags, AI Configs, experiments, segments, and more
- **Collaboration Insights**: Discover who you work with most on feature flags
- **Comparative Rankings**: See how you stack up against other team members
- **Team Reports**: Generate reports for all team members with `--everyone` flag
- **Interactive HTML Output**: Beautiful, shareable HTML reports with team awards
- **Dual Input Modes**: Fetch from API or read from local JSONL file
- **Custom Endpoints**: Support for federal and private cloud LaunchDarkly instances
- **Automatic Identity Detection**: Uses caller identity API to determine current user
- **Fast Parallel Fetching**: Configurable parallel requests for faster API downloads (default: 10)
- **30+ Achievements**: Unlock achievements based on your activity patterns

## Usage

### chronicle.ts - Generate JSON Reports

```bash
deno run --allow-net --allow-env --allow-read chronicle.ts [options]
```

**Options:**
- `--input <file>`: Read audit log from JSONL file instead of fetching from API
- `--year <year>`: Specify year for report (default: current year)
- `--parallel <num>`: Number of parallel requests for API fetching (default: 10)
- `--everyone`: Generate reports for all team members (outputs NDJSON)
- `--base-url <url>`: LaunchDarkly API base URL (for federal/private cloud)
- `--help, -h`: Show help message

### html.ts - Generate HTML Reports

```bash
deno run --allow-net --allow-env --allow-read --allow-write html.ts [options]
```

**Options:**
- `--input <file>`: Read audit log from JSONL file instead of fetching from API
- `--output <file>, -o`: Output HTML file (default: stdout)
- `--year <year>`: Specify year for report (default: current year)
- `--parallel <num>`: Number of parallel requests for API fetching (default: 10)
- `--everyone`: Generate interactive multi-member HTML with team awards
- `--base-url <url>`: LaunchDarkly API base URL (for federal/private cloud)
- `--help, -h`: Show help message

### Environment Variables

- `LAUNCHDARKLY_API_KEY` or `LD_API_KEY`: Your LaunchDarkly API key (required)
- `LD_BASE_URL` or `LAUNCHDARKLY_BASE_URL`: API base URL (default: https://app.launchdarkly.com)

## Examples

### Generate JSON Report for Current User

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts
```

### Generate HTML Report for Current User

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts --output my-wrapped.html
```

### Generate Team Report (All Members)

```bash
# JSON output (NDJSON format - one report per line)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts --everyone > team-reports.json

# Interactive HTML with team awards
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts --everyone --output team-wrapped.html
```

### Use Custom LaunchDarkly Endpoint

```bash
# Federal instance
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write \
  html.ts --base-url https://app.launchdarkly.us --output wrapped.html

# Private cloud
LD_BASE_URL=https://app.ld.catamorphic.com LAUNCHDARKLY_API_KEY=api-123 \
  deno run --allow-net --allow-env --allow-read --allow-write html.ts --output wrapped.html
```

### Read from Pre-fetched Audit Log

```bash
# Faster for repeated generation
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write \
  html.ts --input audit-log.json --everyone --output team-wrapped.html
```

### Generate Report for Specific Year

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read chronicle.ts --year 2024
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
- **flagUpdates**: Number of flag behavior changes (targeting, rules, on/off, etc.) - only counts meaningful updates
- **experimentsCreated**: Number of experiments created
- **segmentsCreated**: Number of segments created
- **aiConfigsCreated**: Number of AI Configs created
- **approvals**: Approval workflow participation
  - **created**: Approval requests you created
  - **reviewed**: Approval requests you reviewed
  - **applied**: Approval requests you applied
- **releasePipelines**: Release pipeline activity
  - **created**: Release pipelines you created
  - **used**: Times you used release pipelines
  - **phasesProgressed**: Number of release pipeline phases you progressed
- **integrationsCreated**: Number of integrations created
- **guardedRollouts**: Number of guarded/measured rollouts
- **projectsWorkedOn**: List of project keys the user contributed to
- **totalProjects**: Count of unique projects
- **peakActivity**: When the user was most active
  - **month**: Most active month name and count
  - **day**: Most active single day and count
  - **hour**: Most active hour (0-23 UTC) and count
- **remediation**: Flag recovery tracking (null if no toggles)
  - **fastestSeconds**: Fastest time to turn a flag back on after turning it off
  - **fastestFlag**: Name of the flag with fastest recovery
  - **totalToggles**: Number of times you turned flags off then back on
  - **averageSeconds**: Average time flags were off
- **oops**: Rollback tracking in critical environments (null if no rollbacks)
  - **fastestSeconds**: Fastest rollback time (turned on then quickly turned off)
  - **fastestFlag**: Name of the flag with fastest rollback
  - **totalRollbacks**: Number of quick rollbacks
- **insights**: Interesting patterns about your work style
  - **longestStreak**: Longest consecutive days with activity
  - **weekendWarrior**: Whether you work on weekends frequently (>50 actions)
  - **cleanupCrew**: Whether you archive >50% of flags you create
  - **topEnvironment**: Environment you work in most
  - **productionChanges**: Number of critical environment changes (`;critical` tag)
  - **fridayActions**: Number of actions taken on Fridays
  - **approvalBuddy**: Team member who reviewed the most of your approval requests (null if none)

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

### Achievements

Chronicle includes 30+ achievements you can unlock based on your activity:

**Quantity-Based:**
- 🚩 Century Club (100+ flags created)
- 🧪 Experiment Enthusiast (20+ experiments)
- 🎯 Segment Master (50+ segments)
- 🤖 AI Architect (20+ AI Configs)
- 🛡️ Safe Hands (20+ guarded rollouts)

**Rank-Based (Team Leaders):**
- 🧹 Captain Cleanup (Most flags archived)
- 🛡️ Safety Champion (Most guarded rollouts)
- 🧪 Experiment Leader (Most experiments)
- 🤖 AI Innovator (Most AI Configs)
- 🎉 Friday Warrior (Most Friday actions)

**Performance-Based:**
- ⚡ Lightning Fast (Sub-60 second flag recovery)
- 📦 Release Manager (50+ pipeline phases progressed)
- ✅ Governance Guru (100+ approvals reviewed)
- 🔥 On Fire (30+ day activity streak)

**Pattern-Based:**
- ⚔️ Weekend Warrior (Weekend activity)
- 🦋 Social Butterfly (Most collaborators)

### Team Awards (HTML Output)

When using `--everyone` with html.ts, team awards are displayed showing top performers:

1. 🚩 **Most Flags Created** - Top flag creator
2. 🛡️ **Safety Champion** - Most guarded rollouts
3. 🧪 **Experiment Leader** - Most experiments
4. 🧹 **Captain Cleanup** - Most flags archived
5. ✅ **Governance Guru** - Most approvals reviewed
6. 🔥 **Longest Streak** - Longest consecutive activity
7. 🎯 **Segment Master** - Most segments created (or "Top Segment Creator" if <50)
8. ⚙️ **Production Pro** - Most critical environment changes
9. ⚡ **Quickest Rollback** - Fastest rollback in critical environment
10. 🎉 **Friday Flipper** - Most Friday actions

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

### chronicle.ts
- `--allow-net`: Make HTTP requests to LaunchDarkly API
- `--allow-env`: Read API key environment variable
- `--allow-read`: Read audit log file (if using `--input`)

### html.ts
- `--allow-net`: Make HTTP requests to LaunchDarkly API
- `--allow-env`: Read API key environment variable
- `--allow-read`: Read audit log file (if using `--input`)
- `--allow-write`: Write HTML file (if using `--output`)

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
  - Uses parallel fetching by default (10 concurrent requests)
  - Progress updates show real-time entry counts
  - Typical year-long fetch: 30-60 seconds with 10 parallel requests
  - With `--everyone`: Fetches audit logs once, generates all reports in memory (10-100x faster than previous versions)
- **File Mode**: Fastest for repeated analysis, especially with `--everyone`
- Large audit logs are processed in a streaming fashion to minimize memory usage
- Optimized achievement calculations for team reports (O(n) complexity)
- Adjust `--parallel` based on your needs:
  - Higher (15-20): Faster but more API load
  - Lower (5): More conservative, better for rate limits
  - Default (10): Good balance for most use cases

### HTML Output

The interactive HTML report includes:
- **Smooth scrolling slides** - Navigate with mouse wheel, arrow keys, or space bar
- **Team awards page** - Shows top performers when using `--everyone`
- **Member selection** - Search and view individual reports
- **URL parameters** - Direct link to specific member (`?member=user@example.com`)
- **Embedded data** - All reports included in a single HTML file (no external dependencies)
- **Mobile responsive** - Works great on phones and tablets

### Team Reports Best Practices

When generating team reports with `--everyone`:
1. Use `--input` with a pre-fetched audit log for speed
2. The HTML file embeds all member data - it can be large (5-10MB for large teams)
3. Share the HTML file directly - no server required
4. Use URL parameters to share specific member reports: `team-wrapped.html?member=jane@example.com`

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
