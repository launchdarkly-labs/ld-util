#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { generateChronicleReport } from "./chronicle.ts";
import type { ChronicleReport } from "./chronicle.ts";

function generateHTML(report: ChronicleReport): string {
    const user = report.user;
    const stats = report.stats;
    const achievements = report.achievements;
    const collaborators = report.collaborators;
    const rankings = report.rankings;

    // Helper to format large numbers
    const formatNumber = (num: number) => num.toLocaleString();

    // Helper to format time
    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
        return `${Math.round(seconds / 86400)}d`;
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${user.firstName}'s ${report.year} LaunchDarkly Chronicle</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            overflow-x: hidden;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
        }

        .slide {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 40px 20px;
            text-align: center;
            animation: fadeIn 0.8s ease-in;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(20px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .slide h1 {
            font-size: 4rem;
            font-weight: 900;
            margin-bottom: 1rem;
            background: linear-gradient(135deg, #fff 0%, #f0f0f0 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .slide h2 {
            font-size: 3rem;
            font-weight: 800;
            margin-bottom: 2rem;
        }

        .slide h3 {
            font-size: 2rem;
            font-weight: 700;
            margin-bottom: 1rem;
            opacity: 0.9;
        }

        .slide p {
            font-size: 1.5rem;
            opacity: 0.9;
            margin-bottom: 1rem;
        }

        .big-stat {
            font-size: 8rem;
            font-weight: 900;
            line-height: 1;
            margin: 2rem 0;
            text-shadow: 0 4px 20px rgba(0,0,0,0.3);
        }

        .stat-label {
            font-size: 2rem;
            font-weight: 600;
            opacity: 0.8;
            text-transform: uppercase;
            letter-spacing: 2px;
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 2rem;
            margin: 2rem 0;
            width: 100%;
        }

        .stat-card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .stat-card .number {
            font-size: 3rem;
            font-weight: 900;
            margin-bottom: 0.5rem;
        }

        .stat-card .label {
            font-size: 1rem;
            opacity: 0.8;
            text-transform: uppercase;
            letter-spacing: 1px;
        }

        .achievement-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
            margin: 2rem 0;
            width: 100%;
        }

        .achievement-card {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.05) 100%);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 1.5rem;
            border: 2px solid rgba(255, 255, 255, 0.3);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .achievement-card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        }

        .achievement-card .emoji {
            font-size: 3rem;
            margin-bottom: 0.5rem;
        }

        .achievement-card .name {
            font-size: 1.3rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
        }

        .achievement-card .description {
            font-size: 0.9rem;
            opacity: 0.9;
        }

        .collaborator-list {
            width: 100%;
            max-width: 600px;
        }

        .collaborator-item {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 1rem 1.5rem;
            margin-bottom: 1rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .collaborator-item .name {
            font-size: 1.2rem;
            font-weight: 600;
        }

        .collaborator-item .count {
            font-size: 1.5rem;
            font-weight: 900;
            opacity: 0.8;
        }

        .ranking-card {
            background: linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, rgba(255, 255, 255, 0.1) 100%);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 2rem;
            margin: 2rem 0;
            border: 2px solid rgba(255, 255, 255, 0.3);
        }

        .rank-badge {
            display: inline-block;
            background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
            color: #333;
            font-size: 4rem;
            font-weight: 900;
            padding: 1rem 2rem;
            border-radius: 15px;
            margin-bottom: 1rem;
            box-shadow: 0 10px 30px rgba(255, 215, 0, 0.3);
        }

        .percentile {
            font-size: 2rem;
            font-weight: 700;
            margin-top: 1rem;
            opacity: 0.9;
        }

        .top-creators {
            width: 100%;
            max-width: 600px;
            margin-top: 2rem;
        }

        .creator-item {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
            padding: 1rem;
            margin-bottom: 0.5rem;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .creator-item.highlight {
            background: rgba(255, 215, 0, 0.3);
            border: 2px solid rgba(255, 215, 0, 0.5);
        }

        @media (max-width: 768px) {
            .slide h1 { font-size: 2.5rem; }
            .slide h2 { font-size: 2rem; }
            .big-stat { font-size: 5rem; }
            .stats-grid { grid-template-columns: 1fr; }
            .achievement-grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Title Slide -->
        <div class="slide">
            <h1>🎊 LaunchDarkly Chronicle ${report.year}</h1>
            <h3>${user.firstName} ${user.lastName}</h3>
            <p>${user.email}</p>
        </div>

        <!-- Flags Created -->
        <div class="slide">
            <p class="stat-label">You created</p>
            <div class="big-stat">${formatNumber(stats.flagsCreated)}</div>
            <p class="stat-label">Flags</p>
        </div>

        <!-- Rank -->
        ${rankings.flagsCreated.rank <= 3 ? `
        <div class="slide">
            <h2>You ranked</h2>
            <div class="rank-badge">#${rankings.flagsCreated.rank}</div>
            <p class="stat-label">Flag Creator in Your Team</p>
            <p class="percentile">Top ${100 - rankings.flagsCreated.percentile}%</p>
        </div>
        ` : ''}

        <!-- Multiple Stats -->
        <div class="slide">
            <h2>Your ${report.year} in Numbers</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.flagUpdates)}</div>
                    <div class="label">Flag Updates</div>
                </div>
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.segmentsCreated)}</div>
                    <div class="label">Segments</div>
                </div>
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.experimentsCreated)}</div>
                    <div class="label">Experiments</div>
                </div>
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.approvals.reviewed)}</div>
                    <div class="label">Approvals Reviewed</div>
                </div>
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.guardedRollouts)}</div>
                    <div class="label">Guarded Rollouts</div>
                </div>
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.totalProjects)}</div>
                    <div class="label">Projects</div>
                </div>
            </div>
        </div>

        <!-- Peak Activity -->
        <div class="slide">
            <h2>Your Peak Activity</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="number">${stats.peakActivity.month}</div>
                    <div class="label">Busiest Month</div>
                    <p style="margin-top: 1rem; opacity: 0.8;">${formatNumber(stats.peakActivity.count)} actions</p>
                </div>
                <div class="stat-card">
                    <div class="number">${stats.peakActivity.day.split('-')[2]}</div>
                    <div class="label">Busiest Day</div>
                    <p style="margin-top: 1rem; opacity: 0.8;">${formatNumber(stats.peakActivity.dayCount)} actions on ${stats.peakActivity.day}</p>
                </div>
                ${stats.peakActivity.hour !== undefined ? `
                <div class="stat-card">
                    <div class="number">${stats.peakActivity.hour}:00</div>
                    <div class="label">Peak Hour</div>
                    <p style="margin-top: 1rem; opacity: 0.8;">${formatNumber(stats.peakActivity.hourCount)} actions</p>
                </div>
                ` : ''}
            </div>
        </div>

        <!-- Remediation -->
        ${stats.remediation ? `
        <div class="slide">
            <h2>⚡ Quickest Flag Recovery</h2>
            <div class="big-stat">${formatTime(stats.remediation.fastestSeconds)}</div>
            <p class="stat-label">"${stats.remediation.fastestFlag}"</p>
            <p style="margin-top: 2rem; opacity: 0.8;">
                You toggled ${stats.remediation.totalToggles} flags off then back on
                <br>
                Average time off: ${formatTime(stats.remediation.averageSeconds)}
            </p>
        </div>
        ` : ''}

        <!-- Collaborators -->
        ${collaborators.length > 0 ? `
        <div class="slide">
            <h2>Your Top Collaborators</h2>
            <div class="collaborator-list">
                ${collaborators.slice(0, 5).map(c => `
                    <div class="collaborator-item">
                        <div class="name">${c.name}</div>
                        <div class="count">${c.sharedFlags} flags</div>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Achievements -->
        ${achievements.length > 0 ? `
        <div class="slide">
            <h2>🏆 Achievements Unlocked</h2>
            <div class="big-stat">${achievements.length}</div>
            <p class="stat-label">Achievements Earned</p>
        </div>

        <div class="slide">
            <h2>Your Achievements</h2>
            <div class="achievement-grid">
                ${achievements.map(a => {
                    const emoji = a.name.split(' ')[0];
                    const name = a.name.substring(emoji.length + 1);
                    return `
                        <div class="achievement-card">
                            <div class="emoji">${emoji}</div>
                            <div class="name">${name}</div>
                            <div class="description">${a.description}</div>
                        </div>
                    `;
                }).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Insights -->
        ${stats.insights ? `
        <div class="slide">
            <h2>Your Work Style</h2>
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="number">${stats.insights.longestStreak}</div>
                    <div class="label">Day Streak</div>
                </div>
                <div class="stat-card">
                    <div class="number">${stats.insights.topEnvironment}</div>
                    <div class="label">Top Environment</div>
                </div>
                <div class="stat-card">
                    <div class="number">${formatNumber(stats.insights.productionChanges)}</div>
                    <div class="label">Production Changes</div>
                </div>
            </div>
            ${stats.insights.nightOwl ? '<p style="margin-top: 2rem; font-size: 1.5rem;">🦉 Night Owl - You work late!</p>' : ''}
            ${stats.insights.earlyBird ? '<p style="margin-top: 2rem; font-size: 1.5rem;">🌅 Early Bird - You start early!</p>' : ''}
            ${stats.insights.weekendWarrior ? '<p style="margin-top: 2rem; font-size: 1.5rem;">⚔️ Weekend Warrior - You work weekends!</p>' : ''}
            ${stats.insights.cleanupCrew ? '<p style="margin-top: 2rem; font-size: 1.5rem;">🧹 Cleanup Crew - You keep things tidy!</p>' : ''}
        </div>
        ` : ''}

        <!-- Top Creators -->
        ${rankings.flagsCreated.topCreators.length > 0 ? `
        <div class="slide">
            <h2>Top Flag Creators</h2>
            <div class="top-creators">
                ${rankings.flagsCreated.topCreators.map((creator, idx) => `
                    <div class="creator-item ${creator.memberId === user.memberId ? 'highlight' : ''}">
                        <span style="font-weight: 900; margin-right: 1rem;">#${idx + 1}</span>
                        <span style="flex: 1;">${creator.name}</span>
                        <span style="font-weight: 900;">${formatNumber(creator.count)}</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}

        <!-- Final Slide -->
        <div class="slide">
            <h1>Thanks for an amazing ${report.year}!</h1>
            <p style="margin-top: 2rem; font-size: 1.2rem; opacity: 0.8;">
                Created with Chronicle by LaunchDarkly
            </p>
        </div>
    </div>

    <script>
        // Debounced scroll handling to prevent accidental skips
        let isScrolling = false;
        let scrollTimeout;

        document.addEventListener('wheel', (e) => {
            // Don't prevent default - allow natural scrolling
            // But add snap behavior when scroll stops

            clearTimeout(scrollTimeout);

            scrollTimeout = setTimeout(() => {
                const slides = document.querySelectorAll('.slide');
                const currentPosition = window.scrollY;

                // Find the closest slide
                let closestSlide = 0;
                let closestDistance = Infinity;

                slides.forEach((slide, index) => {
                    const slideTop = slide.offsetTop;
                    const distance = Math.abs(currentPosition - slideTop);

                    if (distance < closestDistance) {
                        closestDistance = distance;
                        closestSlide = index;
                    }
                });

                // Snap to closest slide
                slides[closestSlide].scrollIntoView({ behavior: 'smooth' });
            }, 150); // Wait 150ms after scroll stops
        });

        // Arrow key navigation with debouncing
        let keyTimeout;
        document.addEventListener('keydown', (e) => {
            if (keyTimeout) return; // Prevent rapid key presses

            const slides = document.querySelectorAll('.slide');
            const currentSlide = Math.round(window.scrollY / window.innerHeight);

            if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === ' ') {
                e.preventDefault();
                const nextSlide = Math.min(slides.length - 1, currentSlide + 1);
                slides[nextSlide].scrollIntoView({ behavior: 'smooth' });

                keyTimeout = setTimeout(() => keyTimeout = null, 600);
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                e.preventDefault();
                const prevSlide = Math.max(0, currentSlide - 1);
                slides[prevSlide].scrollIntoView({ behavior: 'smooth' });

                keyTimeout = setTimeout(() => keyTimeout = null, 600);
            } else if (e.key === 'Home') {
                e.preventDefault();
                slides[0].scrollIntoView({ behavior: 'smooth' });
            } else if (e.key === 'End') {
                e.preventDefault();
                slides[slides.length - 1].scrollIntoView({ behavior: 'smooth' });
            }
        });

        // Add CSS scroll snap for better native scrolling
        document.documentElement.style.scrollSnapType = 'y proximity';
        document.querySelectorAll('.slide').forEach(slide => {
            slide.style.scrollSnapAlign = 'start';
        });
    </script>
</body>
</html>`;
}

// Main execution
if (import.meta.main) {
    const API_KEY = Deno.env.get("LAUNCHDARKLY_API_KEY") ||
        Deno.env.get("LD_API_KEY");
    if (!API_KEY) {
        console.error(
            "Error: LAUNCHDARKLY_API_KEY or LD_API_KEY environment variable is required",
        );
        Deno.exit(1);
    }

    // Parse command line arguments
    let inputFile: string | undefined;
    let outputFile: string | undefined; // undefined = stdout
    let year: number | undefined;
    let parallelChunks = 10; // Default to 10 parallel requests

    for (let i = 0; i < Deno.args.length; i++) {
        const arg = Deno.args[i];
        if (arg === "--input") {
            inputFile = Deno.args[i + 1];
            i++;
        } else if (arg === "--output" || arg === "-o") {
            outputFile = Deno.args[i + 1];
            i++;
        } else if (arg === "--year") {
            year = parseInt(Deno.args[i + 1]);
            i++;
        } else if (arg === "--parallel") {
            parallelChunks = parseInt(Deno.args[i + 1]);
            if (isNaN(parallelChunks) || parallelChunks < 1) {
                console.error("Error: --parallel must be a positive integer");
                Deno.exit(1);
            }
            i++;
        } else if (arg === "--help" || arg === "-h") {
            console.log(`Chronicle HTML - Generate a Spotify Wrapped-style HTML report

Usage:
  html.ts [options]

Options:
  --input <file>        Read audit log from JSONL file
  --output <file>, -o   Output HTML file (default: stdout)
                        Use '-' for stdout
  --year <year>         Year for report (default: current year)
  --parallel <num>      Number of parallel requests (default: 10)
  --help, -h            Show this help message

Examples:
  # Output to stdout (default)
  html.ts > my-wrapped.html

  # Output to specific file
  html.ts --output chronicle.html

  # Pipe through other tools
  html.ts | gzip > wrapped.html.gz

  # Read from file, write to file with 5 parallel requests
  html.ts --input audit-log.json --output my-wrapped.html --parallel 5

  # Output to stdout explicitly
  html.ts --output - > wrapped.html
`);
            Deno.exit(0);
        }
    }

    try {
        console.error("Generating Chronicle report...");
        const report = await generateChronicleReport(API_KEY, inputFile, year, parallelChunks);

        console.error("Creating HTML...");
        const html = generateHTML(report);

        // Write to stdout or file
        if (!outputFile || outputFile === "-") {
            // Write to stdout
            console.log(html);
        } else {
            // Write to file
            console.error(`Writing to ${outputFile}...`);
            await Deno.writeTextFile(outputFile, html);
            console.error(`✨ Success! Open ${outputFile} in your browser.`);
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        Deno.exit(1);
    }
}
