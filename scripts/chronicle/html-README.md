# Chronicle HTML - Spotify Wrapped Style Report

Generate a beautiful, interactive HTML report of your LaunchDarkly activity in Spotify Wrapped style!

## Features

- 🎨 **Spotify Wrapped Style Design** - Gradient backgrounds, bold typography, smooth animations
- 📱 **Responsive** - Works on desktop and mobile
- 🎯 **Interactive** - Scroll or use arrow keys to navigate slides
- ✨ **Visual Storytelling** - Stats, achievements, and insights presented beautifully
- 📊 **All Your Stats** - Flags, experiments, segments, approvals, and more
- 🏆 **Achievement Showcase** - All earned achievements with emojis and descriptions
- 🤝 **Collaborator Highlights** - See who you worked with most
- 📈 **Rankings** - Your position among teammates

## Usage

```bash
deno run --allow-net --allow-env --allow-read --allow-write html.ts [options]
```

### Options

- `--input <file>`: Read audit log from JSONL file
- `--output <file>, -o`: Output HTML filename (default: **stdout**)
  - Use `-` for explicit stdout
- `--year <year>`: Specify year for report (default: current year)
- `--help, -h`: Show help message

### Environment Variables

- `LAUNCHDARKLY_API_KEY` or `LD_API_KEY`: Your LaunchDarkly API key (required)

## Examples

### Generate to stdout (Default)

```bash
# Redirect to file
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts > wrapped.html

# Pipe through gzip
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts | gzip > wrapped.html.gz

# View in browser directly (macOS)
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts > /tmp/wrapped.html && open /tmp/wrapped.html
```

### Generate to a File

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts \
  --output my-wrapped.html

# Or use short flag
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts \
  -o my-wrapped.html
```

### Read from File, Write to File

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts \
  --input audit-log.json \
  --output my-2025-wrapped.html
```

### Generate for Specific Year

```bash
LAUNCHDARKLY_API_KEY=api-123 deno run --allow-net --allow-env --allow-read --allow-write html.ts \
  --year 2024 > 2024-wrapped.html
```

## Viewing the Report

Simply open the generated HTML file in your web browser:

```bash
open chronicle-wrapped.html
```

Or drag and drop it into your browser.

## Navigation

- **Scroll** - Scroll up/down to navigate slides
- **Arrow Keys** - Use ↑↓ or ←→ to navigate
- **Mouse Wheel** - Scroll through slides smoothly

## What's Included

The HTML report includes:

1. **Title Slide** - Your name and year
2. **Big Stats** - Flags created with dramatic reveal
3. **Ranking** - Your position in the team (if top 3)
4. **Numbers Grid** - All your key metrics in cards
5. **Peak Activity** - Busiest month, day, and hour
6. **Fastest Fix** - Your quickest flag remediation
7. **Collaborators** - Top 5 people you worked with
8. **Achievement Count** - Total achievements earned
9. **Achievement Gallery** - All achievements with descriptions
10. **Work Style** - Insights about your patterns
11. **Top Creators** - Leaderboard with your position highlighted
12. **Thank You** - Closing slide

## Customization

The HTML is a single self-contained file with embedded CSS and JavaScript. You can customize:

- **Colors**: Edit the gradient backgrounds in the `<style>` section
- **Layout**: Modify the grid layouts and card styles
- **Content**: Add or remove slides by editing the HTML generation

## Technical Details

- **No Dependencies**: Pure HTML, CSS, and JavaScript
- **No Build Step**: Single file, ready to share
- **Smooth Animations**: CSS transitions and JavaScript scroll handling
- **Responsive Design**: Adapts to different screen sizes
- **Accessibility**: Keyboard navigation support

## Sharing

The generated HTML file is completely self-contained and can be:
- Emailed to teammates
- Shared on Slack/Teams
- Hosted on any web server
- Viewed offline

## Tips

- Generate your report at year-end for a complete yearly summary
- Share with your team to celebrate accomplishments
- Compare reports year-over-year to track growth
- Use `--input` with pre-fetched audit logs for faster generation

## Example Output

The report presents your data in engaging slides:

```
🎊 Chronicle Wrapped 2025
           ↓
    You created
       132
      Flags!
           ↓
    You ranked
       #2
   Flag Creator
    Top 6%
           ↓
   [Stats Grid with all metrics]
           ↓
   [And many more slides...]
```

---

**Enjoy your Chronicle Wrapped!** 🎊
