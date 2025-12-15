#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write

import { generateChronicleReport, generateAllMemberReports } from "./chronicle.ts";
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
            word-break: break-word;
            overflow-wrap: break-word;
            hyphens: auto;
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
        ${rankings.flagsCreated.rank <= 3 && stats.flagsCreated > 0 ? `
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
                    <div class="number" style="font-size: 2.5rem;">${stats.peakActivity.month}</div>
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

        <!-- Approval Buddy -->
        ${stats.insights?.approvalBuddy ? `
        <div class="slide">
            <h2>✅ Your Approval Buddy</h2>
            <div class="big-stat" style="font-size: 6rem;">${stats.insights.approvalBuddy.name}</div>
            <p class="stat-label">Your Go-To Reviewer</p>
            <p style="margin-top: 2rem; font-size: 1.3rem; opacity: 0.9;">
                Reviewed <strong>${stats.insights.approvalBuddy.approvalsReviewed}</strong> of your approval requests
            </p>
        </div>
        ` : ''}

        <!-- Polymath Achievement - Special Animated Slide -->
        ${achievements.some(a => a.name.includes('🌟 Polymath')) ? `
        <div class="slide polymath-award-slide">
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <div class="polymath-confetti"></div>
            <h1 style="font-size: 3rem; margin-bottom: 2rem; position: relative; z-index: 1;">🌟 You are the Polymath! 🌟</h1>
            <div class="big-stat" style="position: relative; z-index: 1;">${(() => {
                const polymathAch = achievements.find(a => a.name.includes('Polymath'));
                return polymathAch?.value || 0;
            })()}</div>
            <p class="stat-label" style="position: relative; z-index: 1;">Platform Mastery Points</p>
            <p style="font-size: 1.1rem; opacity: 0.8; margin-top: 0.5rem; position: relative; z-index: 1;">(Breadth × Consistency)</p>
            <p style="margin-top: 2rem; font-size: 1.3rem; max-width: 700px; margin-left: auto; margin-right: auto; opacity: 0.95; position: relative; z-index: 1;">
                You've mastered the LaunchDarkly platform with exceptional breadth and consistency, using advanced features like Experimentation, AI Configs, and Release Pipelines alongside core capabilities.
            </p>
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
                    
                    // Add special handling for Oops! achievement to mention Guardian
                    let description = a.description;
                    if (name === "Oops!") {
                        description += " (Guardian can help prevent these!)";
                    }
                    
                    return `
                        <div class="achievement-card">
                            <div class="emoji">${emoji}</div>
                            <div class="name">${name}</div>
                            <div class="description">${description}</div>
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

        // Count-up animation for big-stat numbers
        function animateNumber(element, start, end, duration) {
            const startTime = performance.now();
            const hasComma = element.textContent.includes(',');

            function update(currentTime) {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Easing function (ease-out)
                const easeOut = 1 - Math.pow(1 - progress, 3);
                const current = Math.floor(start + (end - start) * easeOut);

                // Format with commas if original had them
                element.textContent = hasComma ? current.toLocaleString() : current;

                if (progress < 1) {
                    requestAnimationFrame(update);
                }
            }

            requestAnimationFrame(update);
        }

        // Observe slides and animate big-stat numbers when they come into view
        const animatedStats = new Set();
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !animatedStats.has(entry.target)) {
                    const bigStat = entry.target.querySelector('.big-stat');
                    if (bigStat && !bigStat.dataset.animated) {
                        const text = bigStat.textContent.trim();
                        const number = parseInt(text.replace(/,/g, ''), 10);

                        if (!isNaN(number) && number > 0) {
                            bigStat.dataset.animated = 'true';
                            animateNumber(bigStat, 0, number, 1500);
                        }
                    }
                    animatedStats.add(entry.target);
                }
            });
        }, { threshold: 0.5 });

        // Observe all slides
        document.querySelectorAll('.slide').forEach(slide => {
            observer.observe(slide);
        });
    </script>
</body>
</html>`;
}

function generateMultiMemberHTML(reports: ChronicleReport[]): string {
    const year = reports[0]?.year || new Date().getFullYear();

    // Helper to format large numbers
    const formatNumber = (num: number) => num.toLocaleString();

    // Helper to format time
    const formatTime = (seconds: number) => {
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
        if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
        return `${Math.round(seconds / 86400)}d`;
    };

    // Calculate team leaders for each category
    const teamLeaders = {
        flagsCreated: reports.reduce((max, r) => r.stats.flagsCreated > (max?.stats.flagsCreated || 0) ? r : max, reports[0]),
        guardedRollouts: reports.reduce((max, r) => r.stats.guardedRollouts > (max?.stats.guardedRollouts || 0) ? r : max, reports[0]),
        experiments: reports.reduce((max, r) => r.stats.experimentsCreated > (max?.stats.experimentsCreated || 0) ? r : max, reports[0]),
        flagsArchived: reports.reduce((max, r) => r.stats.flagsArchived > (max?.stats.flagsArchived || 0) ? r : max, reports[0]),
        approvalsReviewed: reports.reduce((max, r) => r.stats.approvals.reviewed > (max?.stats.approvals.reviewed || 0) ? r : max, reports[0]),
        longestStreak: reports.reduce((max, r) => r.stats.insights.longestStreak > (max?.stats.insights.longestStreak || 0) ? r : max, reports[0]),
        segments: reports.reduce((max, r) => r.stats.segmentsCreated > (max?.stats.segmentsCreated || 0) ? r : max, reports[0]),
        productionChanges: reports.reduce((max, r) => r.stats.insights.productionChanges > (max?.stats.insights.productionChanges || 0) ? r : max, reports[0]),
        quickestRollback: reports.filter(r => r.stats.oops).reduce((min, r) => {
            if (!min?.stats.oops) return r;
            return r.stats.oops!.fastestSeconds < min.stats.oops!.fastestSeconds ? r : min;
        }, reports.find(r => r.stats.oops)),
        fridayFlipper: reports.reduce((max, r) => r.stats.insights.fridayActions > (max?.stats.insights.fridayActions || 0) ? r : max, reports[0]),
        botMaster: reports.reduce((max, r) => r.stats.insights.aiActions > (max?.stats.insights.aiActions || 0) ? r : max, reports[0]),
        integrator: reports.reduce((max, r) => r.stats.integrationsCreated > (max?.stats.integrationsCreated || 0) ? r : max, reports[0]),
        linkMaster: reports.reduce((max, r) => r.stats.flagLinksCreated > (max?.stats.flagLinksCreated || 0) ? r : max, reports[0]),
        visionary: reports.reduce((max, r) => r.stats.flagsLinkedToViews > (max?.stats.flagsLinkedToViews || 0) ? r : max, reports[0]),
        // Premium award - Polymath (find who has the Polymath achievement)
        polymath: reports.find(r => r.achievements.some(a => a.name.includes('Polymath'))),
        // First achievements - find who has these specific achievements
        firstLight: reports.find(r => r.achievements.some(a => a.name.includes('First Light'))),
        firstFlag: reports.find(r => r.achievements.some(a => a.name.includes('First Flag of the Year'))),
        firstCleanup: reports.find(r => r.achievements.some(a => a.name.includes('First Cleanup'))),
        firstGuardian: reports.find(r => r.achievements.some(a => a.name.includes('First Guardian'))),
        firstExperiment: reports.find(r => r.achievements.some(a => a.name.includes('First Experiment'))),
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LaunchDarkly Chronicle ${year}</title>
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

        /* Member Selection Styles */
        #member-selection {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            padding: 40px 20px;
        }

        #member-selection h1 {
            font-size: 3rem;
            font-weight: 900;
            margin-bottom: 2rem;
            text-align: center;
        }

        #search-box {
            width: 100%;
            max-width: 500px;
            padding: 1rem 1.5rem;
            font-size: 1.1rem;
            border: 2px solid rgba(255, 255, 255, 0.3);
            border-radius: 50px;
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            color: white;
            margin-bottom: 2rem;
            outline: none;
        }

        #search-box::placeholder {
            color: rgba(255, 255, 255, 0.6);
        }

        #search-box:focus {
            border-color: rgba(255, 255, 255, 0.5);
            background: rgba(255, 255, 255, 0.15);
        }

        #member-list {
            width: 100%;
            max-width: 600px;
            max-height: 60vh;
            overflow-y: auto;
            padding: 10px;
        }

        .member-card {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 1.5rem;
            margin-bottom: 1rem;
            border: 2px solid rgba(255, 255, 255, 0.2);
            cursor: pointer;
            transition: all 0.3s ease;
        }

        .member-card:hover {
            transform: translateY(-3px);
            background: rgba(255, 255, 255, 0.2);
            border-color: rgba(255, 255, 255, 0.4);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.3);
        }

        .member-card .name {
            font-size: 1.3rem;
            font-weight: 700;
            margin-bottom: 0.3rem;
        }

        .member-card .email {
            font-size: 0.9rem;
            opacity: 0.8;
            margin-bottom: 0.5rem;
        }

        .member-card .stats {
            font-size: 0.85rem;
            opacity: 0.7;
            margin-top: 0.5rem;
        }

        /* Report Slides Styles (reuse from single report) */
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
            word-break: break-word;
            overflow-wrap: break-word;
            hyphens: auto;
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

        .back-button {
            position: fixed;
            top: 20px;
            left: 20px;
            background: rgba(255, 255, 255, 0.2);
            backdrop-filter: blur(10px);
            border: 2px solid rgba(255, 255, 255, 0.3);
            color: white;
            padding: 0.8rem 1.5rem;
            border-radius: 50px;
            font-size: 1rem;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            z-index: 1000;
        }

        .back-button:hover {
            background: rgba(255, 255, 255, 0.3);
            border-color: rgba(255, 255, 255, 0.5);
            transform: translateX(-3px);
        }

        #report-container {
            display: none;
        }

        /* Polymath Spotlight Styles */
        .polymath-spotlight {
            background: linear-gradient(135deg, rgba(255, 215, 0, 0.3) 0%, rgba(255, 165, 0, 0.2) 100%);
            backdrop-filter: blur(15px);
            border-radius: 25px;
            padding: 3rem;
            margin: 2rem auto 3rem;
            max-width: 900px;
            border: 3px solid rgba(255, 215, 0, 0.5);
            box-shadow: 0 20px 60px rgba(255, 215, 0, 0.3);
            text-align: center;
            animation: spotlightGlow 3s ease-in-out infinite;
        }

        @keyframes spotlightGlow {
            0%, 100% { box-shadow: 0 20px 60px rgba(255, 215, 0, 0.3); }
            50% { box-shadow: 0 20px 80px rgba(255, 215, 0, 0.5); }
        }

        .polymath-spotlight .title {
            font-size: 2.5rem;
            font-weight: 900;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 1rem;
        }

        .polymath-spotlight .star-icon {
            font-size: 3.5rem;
            animation: starRotate 4s linear infinite;
        }

        @keyframes starRotate {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .polymath-spotlight .winner-name {
            font-size: 3rem;
            font-weight: 900;
            margin-bottom: 1rem;
            color: #FFD700;
            text-shadow: 0 2px 10px rgba(255, 215, 0, 0.5);
        }

        .polymath-spotlight .score {
            font-size: 4rem;
            font-weight: 900;
            margin: 1.5rem 0;
            color: #fff;
        }

        .polymath-spotlight .description {
            font-size: 1.2rem;
            opacity: 0.9;
            line-height: 1.6;
        }

        /* Confetti/Sparkle Animation for Individual Slide */
        .polymath-award-slide {
            position: relative;
            overflow: hidden;
        }

        .polymath-award-slide::before,
        .polymath-award-slide::after {
            content: '✨';
            position: absolute;
            font-size: 2rem;
            opacity: 0;
            animation: sparkleFloat 3s ease-in-out infinite;
        }

        .polymath-award-slide::before {
            top: 10%;
            left: 10%;
            animation-delay: 0s;
        }

        .polymath-award-slide::after {
            top: 15%;
            right: 10%;
            animation-delay: 1.5s;
        }

        @keyframes sparkleFloat {
            0% {
                opacity: 0;
                transform: translateY(0) scale(0.5);
            }
            50% {
                opacity: 1;
                transform: translateY(-20px) scale(1);
            }
            100% {
                opacity: 0;
                transform: translateY(-40px) scale(0.5);
            }
        }

        .polymath-award-slide .big-stat {
            background: linear-gradient(135deg, #FFD700 0%, #FFA500 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
            animation: shimmer 2s ease-in-out infinite, gentlePulse 3s ease-in-out infinite;
        }

        @keyframes shimmer {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.85; }
        }

        @keyframes gentlePulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.05); }
        }

        /* Confetti particles background */
        .polymath-confetti {
            position: absolute;
            width: 10px;
            height: 10px;
            background: #FFD700;
            opacity: 0;
            animation: confettiFall 4s ease-in-out infinite;
            border-radius: 50%;
        }

        .polymath-confetti:nth-child(1) { left: 10%; animation-delay: 0s; background: #FFD700; }
        .polymath-confetti:nth-child(2) { left: 20%; animation-delay: 0.5s; background: #FFA500; }
        .polymath-confetti:nth-child(3) { left: 30%; animation-delay: 1s; background: #FF69B4; }
        .polymath-confetti:nth-child(4) { left: 40%; animation-delay: 1.5s; background: #87CEEB; }
        .polymath-confetti:nth-child(5) { left: 50%; animation-delay: 2s; background: #FFD700; }
        .polymath-confetti:nth-child(6) { left: 60%; animation-delay: 2.5s; background: #FFA500; }
        .polymath-confetti:nth-child(7) { left: 70%; animation-delay: 3s; background: #FF69B4; }
        .polymath-confetti:nth-child(8) { left: 80%; animation-delay: 3.5s; background: #87CEEB; }
        .polymath-confetti:nth-child(9) { left: 90%; animation-delay: 0.8s; background: #FFD700; }

        @keyframes confettiFall {
            0% {
                top: -10%;
                opacity: 0;
                transform: rotate(0deg);
            }
            10% {
                opacity: 0.8;
            }
            90% {
                opacity: 0.8;
            }
            100% {
                top: 110%;
                opacity: 0;
                transform: rotate(720deg);
            }
        }

        .feature-breakdown {
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(10px);
            border-radius: 15px;
            padding: 2rem;
            margin-top: 2rem;
            max-width: 600px;
            margin-left: auto;
            margin-right: auto;
        }

        .feature-bar {
            display: flex;
            align-items: center;
            margin-bottom: 1rem;
            gap: 1rem;
        }

        .feature-bar .label {
            flex: 0 0 150px;
            text-align: right;
            font-weight: 600;
            opacity: 0.9;
        }

        .feature-bar .bar {
            flex: 1;
            height: 25px;
            background: linear-gradient(90deg, rgba(255, 215, 0, 0.8) 0%, rgba(255, 215, 0, 0.3) 100%);
            border-radius: 12px;
            position: relative;
            overflow: hidden;
        }

        .feature-bar .bar::after {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            animation: barShine 2s infinite;
        }

        @keyframes barShine {
            to { left: 100%; }
        }

        @media (max-width: 768px) {
            .slide h1 { font-size: 2.5rem; }
            .slide h2 { font-size: 2rem; }
            .big-stat { font-size: 5rem; }
            .stats-grid { grid-template-columns: 1fr; }
            .achievement-grid { grid-template-columns: 1fr; }
            .polymath-spotlight { padding: 2rem; }
            .polymath-spotlight .title { font-size: 1.8rem; }
            .polymath-spotlight .winner-name { font-size: 2rem; }
            .polymath-spotlight .score { font-size: 3rem; }
        }
    </style>
</head>
<body>
    <div class="container">
        <!-- Member Selection UI -->
        <div id="member-selection">
            <h1>🎊 LaunchDarkly Chronicle ${year}</h1>

            <!-- Team Awards Section -->
            <div style="margin: 3rem 0;">
                <h2 style="font-size: 2rem; font-weight: 800; margin-bottom: 2rem; text-align: center;">🏆 Team Awards</h2>

                <!-- Polymath Spotlight - Premium Award -->
                ${teamLeaders.polymath ? `
                <div class="polymath-spotlight">
                    <div class="title">
                        <span class="star-icon">🌟</span>
                        <span>Platform Polymath</span>
                        <span class="star-icon">🌟</span>
                    </div>
                    <div class="winner-name">${teamLeaders.polymath.user.firstName} ${teamLeaders.polymath.user.lastName}</div>
                    <div class="score">${(() => {
                        const achievement = teamLeaders.polymath.achievements.find(a => a.name.includes('Polymath'));
                        return achievement?.value || 0;
                    })()}</div>
                    <div class="stat-label">Platform Mastery Points</div>
                    <p style="font-size: 1rem; opacity: 0.8; margin-top: 0.5rem;">(Breadth × Consistency across 10+ features)</p>
                    <div class="description" style="margin-top: 1.5rem;">
                        ${(() => {
                            const achievement = teamLeaders.polymath.achievements.find(a => a.name.includes('Polymath'));
                            if (achievement?.description) {
                                // Extract just the top features part
                                const match = achievement.description.match(/Top: (.+)$/);
                                return match ? match[1] : 'Mastered the platform with exceptional breadth and consistency';
                            }
                            return 'Mastered the platform with exceptional breadth and consistency';
                        })()}
                    </div>
                </div>
                ` : ''}

                <div class="achievement-grid" style="max-width: 900px; margin: 0 auto;">
                    <div class="achievement-card">
                        <div class="emoji">💯</div>
                        <div class="name">Most Flags Created</div>
                        <div class="description">
                            <strong>${teamLeaders.flagsCreated.user.firstName} ${teamLeaders.flagsCreated.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.flagsCreated.stats.flagsCreated)} flags
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">🛡️</div>
                        <div class="name">Safety Champion</div>
                        <div class="description">
                            <strong>${teamLeaders.guardedRollouts.user.firstName} ${teamLeaders.guardedRollouts.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.guardedRollouts.stats.guardedRollouts)} guarded rollouts
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">🧪</div>
                        <div class="name">Experiment Leader</div>
                        <div class="description">
                            <strong>${teamLeaders.experiments.user.firstName} ${teamLeaders.experiments.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.experiments.stats.experimentsCreated)} experiments
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">🧹</div>
                        <div class="name">Captain Cleanup</div>
                        <div class="description">
                            <strong>${teamLeaders.flagsArchived.user.firstName} ${teamLeaders.flagsArchived.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.flagsArchived.stats.flagsArchived)} flags archived
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">🛡️</div>
                        <div class="name">Governance Guru</div>
                        <div class="description">
                            <strong>${teamLeaders.approvalsReviewed.user.firstName} ${teamLeaders.approvalsReviewed.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.approvalsReviewed.stats.approvals.reviewed)} approvals reviewed
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">🔥</div>
                        <div class="name">Longest Streak</div>
                        <div class="description">
                            <strong>${teamLeaders.longestStreak.user.firstName} ${teamLeaders.longestStreak.user.lastName}</strong>
                            <br>${teamLeaders.longestStreak.stats.insights.longestStreak} days
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">🎯</div>
                        <div class="name">${teamLeaders.segments.stats.segmentsCreated >= 50 ? 'Segment Master' : 'Top Segment Creator'}</div>
                        <div class="description">
                            <strong>${teamLeaders.segments.user.firstName} ${teamLeaders.segments.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.segments.stats.segmentsCreated)} segments
                        </div>
                    </div>

                    <div class="achievement-card">
                        <div class="emoji">⚙️</div>
                        <div class="name">Production Pro</div>
                        <div class="description">
                            <strong>${teamLeaders.productionChanges.user.firstName} ${teamLeaders.productionChanges.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.productionChanges.stats.insights.productionChanges)} production changes
                        </div>
                    </div>

                    ${teamLeaders.quickestRollback ? `
                    <div class="achievement-card">
                        <div class="emoji">⚡</div>
                        <div class="name">Quickest Rollback</div>
                        <div class="description">
                            <strong>${teamLeaders.quickestRollback.user.firstName} ${teamLeaders.quickestRollback.user.lastName}</strong>
                            <br>${formatTime(teamLeaders.quickestRollback.stats.oops.fastestSeconds)} - "${teamLeaders.quickestRollback.stats.oops.fastestFlag}"
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.fridayFlipper.stats.insights.fridayActions > 0 ? `
                    <div class="achievement-card">
                        <div class="emoji">🎉</div>
                        <div class="name">Friday Flipper</div>
                        <div class="description">
                            <strong>${teamLeaders.fridayFlipper.user.firstName} ${teamLeaders.fridayFlipper.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.fridayFlipper.stats.insights.fridayActions)} Friday actions
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.firstLight ? `
                    <div class="achievement-card">
                        <div class="emoji">💡</div>
                        <div class="name">First Light</div>
                        <div class="description">
                            <strong>${teamLeaders.firstLight.user.firstName} ${teamLeaders.firstLight.user.lastName}</strong>
                            <br>${(() => {
                                const ach = teamLeaders.firstLight.achievements.find(a => a.name.includes('First Light'));
                                return ach?.description || 'Turned on the first flag in production';
                            })()}
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.firstFlag ? `
                    <div class="achievement-card">
                        <div class="emoji">🎉</div>
                        <div class="name">First Flag</div>
                        <div class="description">
                            <strong>${teamLeaders.firstFlag.user.firstName} ${teamLeaders.firstFlag.user.lastName}</strong>
                            <br>${(() => {
                                const ach = teamLeaders.firstFlag.achievements.find(a => a.name.includes('First Flag of the Year'));
                                return ach?.description?.split(': ')[1] || 'First flag created';
                            })()}
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.firstCleanup ? `
                    <div class="achievement-card">
                        <div class="emoji">🗑️</div>
                        <div class="name">First Cleanup</div>
                        <div class="description">
                            <strong>${teamLeaders.firstCleanup.user.firstName} ${teamLeaders.firstCleanup.user.lastName}</strong>
                            <br>${(() => {
                                const ach = teamLeaders.firstCleanup.achievements.find(a => a.name.includes('First Cleanup'));
                                return ach?.description?.split(': ')[1] || 'First flag archived';
                            })()}
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.firstGuardian ? `
                    <div class="achievement-card">
                        <div class="emoji">🛡️</div>
                        <div class="name">First Guardian</div>
                        <div class="description">
                            <strong>${teamLeaders.firstGuardian.user.firstName} ${teamLeaders.firstGuardian.user.lastName}</strong>
                            <br>${(() => {
                                const ach = teamLeaders.firstGuardian.achievements.find(a => a.name.includes('First Guardian'));
                                return ach?.description?.split(': ')[1] || 'First guarded rollout';
                            })()}
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.firstExperiment ? `
                    <div class="achievement-card">
                        <div class="emoji">🧪</div>
                        <div class="name">First Experiment</div>
                        <div class="description">
                            <strong>${teamLeaders.firstExperiment.user.firstName} ${teamLeaders.firstExperiment.user.lastName}</strong>
                            <br>${(() => {
                                const ach = teamLeaders.firstExperiment.achievements.find(a => a.name.includes('First Experiment'));
                                return ach?.description?.split(': ')[1] || 'First experiment created';
                            })()}
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.botMaster.stats.insights.aiActions > 0 ? `
                    <div class="achievement-card">
                        <div class="emoji">🤖</div>
                        <div class="name">Bot Master</div>
                        <div class="description">
                            <strong>${teamLeaders.botMaster.user.firstName} ${teamLeaders.botMaster.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.botMaster.stats.insights.aiActions)} AI actions
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.integrator.stats.integrationsCreated > 0 ? `
                    <div class="achievement-card">
                        <div class="emoji">🔌</div>
                        <div class="name">Integrator</div>
                        <div class="description">
                            <strong>${teamLeaders.integrator.user.firstName} ${teamLeaders.integrator.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.integrator.stats.integrationsCreated)} integrations
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.linkMaster.stats.flagLinksCreated > 0 ? `
                    <div class="achievement-card">
                        <div class="emoji">🔗</div>
                        <div class="name">Link Master</div>
                        <div class="description">
                            <strong>${teamLeaders.linkMaster.user.firstName} ${teamLeaders.linkMaster.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.linkMaster.stats.flagLinksCreated)} flag links
                        </div>
                    </div>
                    ` : ''}

                    ${teamLeaders.visionary.stats.flagsLinkedToViews > 0 ? `
                    <div class="achievement-card">
                        <div class="emoji">👁️</div>
                        <div class="name">Visionary</div>
                        <div class="description">
                            <strong>${teamLeaders.visionary.user.firstName} ${teamLeaders.visionary.user.lastName}</strong>
                            <br>${formatNumber(teamLeaders.visionary.stats.flagsLinkedToViews)} flags linked to views
                        </div>
                    </div>
                    ` : ''}
                </div>
            </div>

            <!-- Member Selection -->
            <div style="margin-top: 4rem;">
                <h2 style="font-size: 1.8rem; font-weight: 700; margin-bottom: 1.5rem; text-align: center;">View Individual Reports</h2>
                <input type="text" id="search-box" placeholder="Search by name or email...">
                <div id="member-list"></div>
            </div>
        </div>

        <!-- Report Container (hidden initially) -->
        <div id="report-container">
            <button class="back-button" onclick="showMemberSelection()">← Back to Selection</button>
            <div id="report-slides"></div>
        </div>
    </div>

    <script>
        // Embed all reports as JSON
        const allReports = ${JSON.stringify(reports)};

        // Debug: Log the structure of reports
        console.log('Total reports loaded:', allReports.length);
        if (allReports.length > 0) {
            console.log('First report structure:', allReports[0]);
        }

        // Helper to format large numbers
        const formatNumber = (num) => num.toLocaleString();

        // Helper to format time
        const formatTime = (seconds) => {
            if (seconds < 60) return \`\${seconds}s\`;
            if (seconds < 3600) return \`\${Math.round(seconds / 60)}m\`;
            if (seconds < 86400) return \`\${Math.round(seconds / 3600)}h\`;
            return \`\${Math.round(seconds / 86400)}d\`;
        };

        // Display member list
        function displayMemberList(filter = '') {
            const memberList = document.getElementById('member-list');
            const filteredReports = allReports.filter(report => {
                if (!report || !report.user) return false;
                const searchText = filter.toLowerCase();
                const fullName = \`\${report.user.firstName || ''} \${report.user.lastName || ''}\`.toLowerCase();
                const email = (report.user.email || '').toLowerCase();
                return fullName.includes(searchText) || email.includes(searchText);
            });

            memberList.innerHTML = filteredReports.map(report => \`
                <div class="member-card" onclick="showReport('\${report.user.memberId}')">
                    <div class="name">\${report.user.firstName || ''} \${report.user.lastName || ''}</div>
                    <div class="email">\${report.user.email || ''}</div>
                    <div class="stats">
                        \${formatNumber(report.stats?.flagsCreated || 0)} flags created •
                        \${formatNumber(report.stats?.flagUpdates || 0)} updates •
                        \${report.achievements?.length || 0} achievements
                    </div>
                </div>
            \`).join('');
        }

        // Search functionality
        document.getElementById('search-box').addEventListener('input', (e) => {
            displayMemberList(e.target.value);
        });

        // Show member selection
        function showMemberSelection() {
            document.getElementById('member-selection').style.display = 'flex';
            document.getElementById('report-container').style.display = 'none';
            window.history.pushState({}, '', window.location.pathname);
            window.scrollTo(0, 0);
        }

        // Show report for specific member
        function showReport(memberId) {
            console.log('Showing report for member:', memberId);
            const report = allReports.find(r => {
                if (!r || !r.user) return false;
                return r.user.memberId === memberId || r.memberId === memberId;
            });

            if (!report) {
                console.error('Report not found for member:', memberId);
                console.error('Available member IDs:', allReports.map(r => r?.user?.memberId).filter(Boolean));
                alert(\`Report not found for member: \${memberId}\`);
                return;
            }

            console.log('Found report:', report.user);

            // Generate HTML for the report (similar to single-member version)
            try {
                const reportHTML = generateReportHTML(report);
                document.getElementById('report-slides').innerHTML = reportHTML;

                // Show report, hide selection
                document.getElementById('member-selection').style.display = 'none';
                document.getElementById('report-container').style.display = 'block';

                // Update URL
                window.history.pushState({}, '', \`?member=\${memberId}\`);

                // Scroll to top and setup scroll behavior
                window.scrollTo(0, 0);
                setupScrollBehavior();
            } catch (error) {
                console.error('Error generating report HTML:', error);
                alert(\`Error displaying report: \${error.message}\`);
            }
        }

        // Generate report HTML
        function generateReportHTML(report) {
            if (!report || !report.user) {
                throw new Error('Invalid report structure');
            }

            const user = report.user;
            const stats = report.stats || {};
            const achievements = report.achievements || [];
            const collaborators = report.collaborators || [];
            const rankings = report.rankings || { flagsCreated: { rank: 0, topCreators: [] } };

            return \`
                <!-- Title Slide -->
                <div class="slide">
                    <h1>🎊 LaunchDarkly Chronicle \${report.year}</h1>
                    <h3>\${user.firstName} \${user.lastName}</h3>
                    <p>\${user.email}</p>
                </div>

                <!-- Flags Created -->
                <div class="slide">
                    <p class="stat-label">You created</p>
                    <div class="big-stat">\${formatNumber(stats.flagsCreated)}</div>
                    <p class="stat-label">Flags</p>
                </div>

                <!-- Rank -->
                \${rankings.flagsCreated.rank <= 3 && stats.flagsCreated > 0 ? \`
                <div class="slide">
                    <h2>You ranked</h2>
                    <div class="rank-badge">#\${rankings.flagsCreated.rank}</div>
                    <p class="stat-label">Flag Creator in Your Team</p>
                    <p class="percentile">Top \${100 - rankings.flagsCreated.percentile}%</p>
                </div>
                \` : ''}

                <!-- Multiple Stats -->
                <div class="slide">
                    <h2>Your \${report.year} in Numbers</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.flagUpdates)}</div>
                            <div class="label">Flag Updates</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.segmentsCreated)}</div>
                            <div class="label">Segments</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.experimentsCreated)}</div>
                            <div class="label">Experiments</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.approvals.reviewed)}</div>
                            <div class="label">Approvals Reviewed</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.guardedRollouts)}</div>
                            <div class="label">Guarded Rollouts</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.totalProjects)}</div>
                            <div class="label">Projects</div>
                        </div>
                    </div>
                </div>

                <!-- Peak Activity -->
                <div class="slide">
                    <h2>Your Peak Activity</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="number" style="font-size: 2.5rem;">\${stats.peakActivity.month}</div>
                            <div class="label">Busiest Month</div>
                            <p style="margin-top: 1rem; opacity: 0.8;">\${formatNumber(stats.peakActivity.count)} actions</p>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${stats.peakActivity.day.split('-')[2]}</div>
                            <div class="label">Busiest Day</div>
                            <p style="margin-top: 1rem; opacity: 0.8;">\${formatNumber(stats.peakActivity.dayCount)} actions on \${stats.peakActivity.day}</p>
                        </div>
                        \${stats.peakActivity.hour !== undefined ? \`
                        <div class="stat-card">
                            <div class="number">\${stats.peakActivity.hour}:00</div>
                            <div class="label">Peak Hour</div>
                            <p style="margin-top: 1rem; opacity: 0.8;">\${formatNumber(stats.peakActivity.hourCount)} actions</p>
                        </div>
                        \` : ''}
                    </div>
                </div>

                <!-- Remediation -->
                \${stats.remediation ? \`
                <div class="slide">
                    <h2>⚡ Quickest Flag Recovery</h2>
                    <div class="big-stat">\${formatTime(stats.remediation.fastestSeconds)}</div>
                    <p class="stat-label">"\${stats.remediation.fastestFlag}"</p>
                    <p style="margin-top: 2rem; opacity: 0.8;">
                        You toggled \${stats.remediation.totalToggles} flags off then back on
                        <br>
                        Average time off: \${formatTime(stats.remediation.averageSeconds)}
                    </p>
                </div>
                \` : ''}

                <!-- Collaborators -->
                \${collaborators.length > 0 ? \`
                <div class="slide">
                    <h2>Your Top Collaborators</h2>
                    <div class="collaborator-list">
                        \${collaborators.slice(0, 5).map(c => \`
                            <div class="collaborator-item">
                                <div class="name">\${c.name}</div>
                                <div class="count">\${c.sharedFlags} flags</div>
                            </div>
                        \`).join('')}
                    </div>
                </div>
                \` : ''}

                <!-- Approval Buddy -->
                \${stats.insights?.approvalBuddy ? \`
                <div class="slide">
                    <h2>✅ Your Approval Buddy</h2>
                    <div class="big-stat" style="font-size: 6rem;">\${stats.insights.approvalBuddy.name}</div>
                    <p class="stat-label">Your Go-To Reviewer</p>
                    <p style="margin-top: 2rem; font-size: 1.3rem; opacity: 0.9;">
                        Reviewed <strong>\${stats.insights.approvalBuddy.approvalsReviewed}</strong> of your approval requests
                    </p>
                </div>
                \` : ''}

                <!-- Polymath Achievement - Special Animated Slide -->
                \${achievements.some(a => a.name.includes('🌟 Polymath')) ? \`
                <div class="slide polymath-award-slide">
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <div class="polymath-confetti"></div>
                    <h1 style="font-size: 3rem; margin-bottom: 2rem; position: relative; z-index: 1;">🌟 You are the Polymath! 🌟</h1>
                    <div class="big-stat" style="position: relative; z-index: 1;">\${(() => {
                        const polymathAch = achievements.find(a => a.name.includes('Polymath'));
                        return polymathAch?.value || 0;
                    })()}</div>
                    <p class="stat-label" style="position: relative; z-index: 1;">Platform Mastery Points</p>
                    <p style="font-size: 1.1rem; opacity: 0.8; margin-top: 0.5rem; position: relative; z-index: 1;">(Breadth × Consistency)</p>
                    <p style="margin-top: 2rem; font-size: 1.3rem; max-width: 700px; margin-left: auto; margin-right: auto; opacity: 0.95; position: relative; z-index: 1;">
                        You've mastered the LaunchDarkly platform with exceptional breadth and consistency, using advanced features like Experimentation, AI Configs, and Release Pipelines alongside core capabilities.
                    </p>
                </div>
                \` : ''}

                <!-- Achievements -->
                \${achievements.length > 0 ? \`
                <div class="slide">
                    <h2>🏆 Achievements Unlocked</h2>
                    <div class="big-stat">\${achievements.length}</div>
                    <p class="stat-label">Achievements Earned</p>
                </div>

                <div class="slide">
                    <h2>Your Achievements</h2>
                    <div class="achievement-grid">
                        \${achievements.map(a => {
                            const emoji = a.name.split(' ')[0];
                            const name = a.name.substring(emoji.length + 1);
                            let description = a.description;
                            if (name === "Oops!") {
                                description += " (Guardian can help prevent these!)";
                            }
                            return \`
                                <div class="achievement-card">
                                    <div class="emoji">\${emoji}</div>
                                    <div class="name">\${name}</div>
                                    <div class="description">\${description}</div>
                                </div>
                            \`;
                        }).join('')}
                    </div>
                </div>
                \` : ''}

                <!-- Insights -->
                \${stats.insights ? \`
                <div class="slide">
                    <h2>Your Work Style</h2>
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="number">\${stats.insights.longestStreak}</div>
                            <div class="label">Day Streak</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${stats.insights.topEnvironment}</div>
                            <div class="label">Top Environment</div>
                        </div>
                        <div class="stat-card">
                            <div class="number">\${formatNumber(stats.insights.productionChanges)}</div>
                            <div class="label">Production Changes</div>
                        </div>
                    </div>
                    \${stats.insights.weekendWarrior ? '<p style="margin-top: 2rem; font-size: 1.5rem;">⚔️ Weekend Warrior - You work weekends!</p>' : ''}
                    \${stats.insights.cleanupCrew ? '<p style="margin-top: 2rem; font-size: 1.5rem;">🧹 Cleanup Crew - You keep things tidy!</p>' : ''}
                </div>
                \` : ''}

                <!-- Top Creators -->
                \${rankings.flagsCreated.topCreators.length > 0 ? \`
                <div class="slide">
                    <h2>Top Flag Creators</h2>
                    <div class="top-creators">
                        \${rankings.flagsCreated.topCreators.map((creator, idx) => \`
                            <div class="creator-item \${creator.memberId === user.memberId ? 'highlight' : ''}">
                                <span style="font-weight: 900; margin-right: 1rem;">#\${idx + 1}</span>
                                <span style="flex: 1;">\${creator.name}</span>
                                <span style="font-weight: 900;">\${formatNumber(creator.count)}</span>
                            </div>
                        \`).join('')}
                    </div>
                </div>
                \` : ''}

                <!-- Final Slide -->
                <div class="slide">
                    <h1>Thanks for an amazing \${report.year}!</h1>
                    <p style="margin-top: 2rem; font-size: 1.2rem; opacity: 0.8;">
                        Created with Chronicle by LaunchDarkly
                    </p>
                </div>
            \`;
        }

        // Setup scroll behavior for slides
        function setupScrollBehavior() {
            document.documentElement.style.scrollSnapType = 'y proximity';
            const slides = document.querySelectorAll('.slide');
            slides.forEach(slide => {
                slide.style.scrollSnapAlign = 'start';
            });

            // Debounced scroll handling
            let scrollTimeout;
            document.addEventListener('wheel', (e) => {
                clearTimeout(scrollTimeout);
                scrollTimeout = setTimeout(() => {
                    const slides = document.querySelectorAll('.slide');
                    const currentPosition = window.scrollY;
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

                    slides[closestSlide].scrollIntoView({ behavior: 'smooth' });
                }, 150);
            });

            // Arrow key navigation
            let keyTimeout;
            document.addEventListener('keydown', (e) => {
                if (keyTimeout) return;
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

            // Count-up animation for big-stat numbers
            function animateNumber(element, start, end, duration) {
                const startTime = performance.now();
                const hasComma = element.textContent.includes(',');

                function update(currentTime) {
                    const elapsed = currentTime - startTime;
                    const progress = Math.min(elapsed / duration, 1);

                    // Easing function (ease-out)
                    const easeOut = 1 - Math.pow(1 - progress, 3);
                    const current = Math.floor(start + (end - start) * easeOut);

                    // Format with commas if original had them
                    element.textContent = hasComma ? current.toLocaleString() : current;

                    if (progress < 1) {
                        requestAnimationFrame(update);
                    }
                }

                requestAnimationFrame(update);
            }

            // Observe slides and animate big-stat numbers when they come into view
            const animatedStats = new Set();
            const observer = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting && !animatedStats.has(entry.target)) {
                        const bigStat = entry.target.querySelector('.big-stat');
                        if (bigStat && !bigStat.dataset.animated) {
                            const text = bigStat.textContent.trim();
                            const number = parseInt(text.replace(/,/g, ''), 10);

                            if (!isNaN(number) && number > 0) {
                                bigStat.dataset.animated = 'true';
                                animateNumber(bigStat, 0, number, 1500);
                            }
                        }
                        animatedStats.add(entry.target);
                    }
                });
            }, { threshold: 0.5 });

            // Observe all slides
            document.querySelectorAll('.slide').forEach(slide => {
                observer.observe(slide);
            });
        }

        // Check URL parameters on load
        window.addEventListener('DOMContentLoaded', () => {
            const params = new URLSearchParams(window.location.search);
            const memberId = params.get('member');

            if (memberId) {
                // Try to find member by ID first, then by email
                const report = allReports.find(r =>
                    r.user.memberId === memberId || r.user.email === memberId
                );

                if (report) {
                    showReport(report.user.memberId);
                } else {
                    console.error('Member not found:', memberId);
                    displayMemberList();
                }
            } else {
                // Default: show member selection with team awards at top
                displayMemberList();
            }
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

    // Get base URL from environment variable or default
    let baseUrl = Deno.env.get("LD_BASE_URL") ||
                  Deno.env.get("LAUNCHDARKLY_BASE_URL") ||
                  "https://app.launchdarkly.com";

    // Parse command line arguments
    let inputFile: string | undefined;
    let outputFile: string | undefined; // undefined = stdout
    let year: number | undefined;
    let parallelChunks = 10; // Default to 10 parallel requests
    let everyone = false;

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
        } else if (arg === "--base-url") {
            baseUrl = Deno.args[i + 1];
            if (!baseUrl) {
                console.error("Error: --base-url requires a URL");
                Deno.exit(1);
            }
            // Ensure it has https:// prefix
            if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
                baseUrl = "https://" + baseUrl;
            }
            i++;
        } else if (arg === "--everyone") {
            everyone = true;
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
  --base-url <url>      LaunchDarkly API base URL (default: https://app.launchdarkly.com)
  --everyone            Generate reports for all members (creates interactive HTML)
  --help, -h            Show this help message

Environment Variables:
  LAUNCHDARKLY_API_KEY or LD_API_KEY - Your LaunchDarkly API key (required)
  LD_BASE_URL or LAUNCHDARKLY_BASE_URL - API base URL (default: https://app.launchdarkly.com)

Examples:
  # Generate HTML for current user
  html.ts --output my-wrapped.html

  # Generate HTML for current user from audit log file
  html.ts --input audit-log.json --output my-wrapped.html

  # Generate interactive HTML for all members
  html.ts --everyone --output wrapped.html

  # Generate interactive HTML for all members from audit log file
  html.ts --everyone --input audit-log.json --output wrapped.html

  # Generate for specific year with 5 parallel requests
  html.ts --everyone --year 2024 --parallel 5 --output wrapped.html
`);
            Deno.exit(0);
        }
    }

    try {
        let html: string;

        if (everyone) {
            // Generate reports for all members using the generator
            console.error("Generating reports for all members...");
            const reports: ChronicleReport[] = [];

            // Use the generator to create reports for all members
            for await (
                const report of generateAllMemberReports(
                    API_KEY,
                    inputFile,
                    year,
                    parallelChunks,
                    baseUrl,
                )
            ) {
                reports.push(report);
            }

            if (reports.length === 0) {
                console.error("Error: No reports generated");
                Deno.exit(1);
            }

            console.error(`Generated ${reports.length} member reports`);
            console.error("Creating interactive HTML...");
            html = generateMultiMemberHTML(reports);
        } else {
            // Generate single report (existing behavior)
            console.error("Generating Chronicle report...");
            const report = await generateChronicleReport(
                API_KEY,
                inputFile,
                year,
                parallelChunks,
                baseUrl,
            );

            console.error("Creating HTML...");
            html = generateHTML(report);
        }

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
