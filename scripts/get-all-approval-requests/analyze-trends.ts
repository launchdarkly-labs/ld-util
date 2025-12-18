#!/usr/bin/env -S deno run --allow-read

/**
 * Analyze approval request trends over time
 * Outputs JSON or HTML visualization showing approval and apply times by month
 */

import { parseArgs } from "jsr:@std/cli/parse-args";

interface ApprovalRequest {
    _id: string;
    creationDate: number;
    reviewStatus?: string;
    status?: string;
    allReviews?: Array<{ kind: string; creationDate: number }>;
    appliedDate?: number;
    project?: { key: string; name: string };
    environments?: Array<{ key: string; name: string }>;
}

interface MonthlyMetrics {
    month: string;
    avgTimeToApproveMs: number | null;
    avgTimeToApplyMs: number | null;
    totalRequests: number;
    approvedCount: number;
    completedCount: number;
    byProjectEnv?: ProjectEnvMetrics[];
}

interface ProjectEnvMetrics {
    projectKey: string;
    projectName: string;
    envKey: string;
    envName: string;
    avgTimeToApproveMs: number | null;
    avgTimeToApplyMs: number | null;
    totalRequests: number;
    approvedCount: number;
    completedCount: number;
}

function formatTime(ms: number | null): string {
    if (ms === null) return "N/A";
    if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.floor(ms / 60000)}m`;
    if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`;
    if (ms < 604800000) return `${(ms / 86400000).toFixed(1)}d`;
    return `${(ms / 604800000).toFixed(1)}w`;
}

function calculateMonthlyMetrics(requests: ApprovalRequest[], includeBreakdown = false): MonthlyMetrics[] {
    const recentRequests = requests;

    // Group by month
    const byMonth = new Map<string, ApprovalRequest[]>();
    for (const req of recentRequests) {
        const date = new Date(req.creationDate);
        const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (!byMonth.has(month)) {
            byMonth.set(month, []);
        }
        byMonth.get(month)!.push(req);
    }

    // Calculate metrics for each month
    const metrics: MonthlyMetrics[] = [];
    for (const [month, reqs] of Array.from(byMonth.entries()).sort()) {
        // Time to approve
        const approveTimes: number[] = [];
        for (const req of reqs) {
            if (req.reviewStatus === "approved" && req.allReviews) {
                const approvalReview = req.allReviews.find(r => r.kind === "approve");
                if (approvalReview) {
                    approveTimes.push(approvalReview.creationDate - req.creationDate);
                }
            }
        }

        // Time to apply
        const applyTimes: number[] = [];
        for (const req of reqs) {
            if (req.status === "completed" && req.reviewStatus === "approved" &&
                req.appliedDate && req.allReviews) {
                const approvalReview = req.allReviews.find(r => r.kind === "approve");
                if (approvalReview) {
                    applyTimes.push(req.appliedDate - approvalReview.creationDate);
                }
            }
        }

        const monthMetric: MonthlyMetrics = {
            month,
            avgTimeToApproveMs: approveTimes.length > 0
                ? approveTimes.reduce((a, b) => a + b, 0) / approveTimes.length
                : null,
            avgTimeToApplyMs: applyTimes.length > 0
                ? applyTimes.reduce((a, b) => a + b, 0) / applyTimes.length
                : null,
            totalRequests: reqs.length,
            approvedCount: reqs.filter(r => r.reviewStatus === "approved").length,
            completedCount: reqs.filter(r => r.status === "completed").length,
        };

        // Add project/environment breakdown if requested
        if (includeBreakdown) {
            const byProjectEnv = new Map<string, ApprovalRequest[]>();
            for (const req of reqs) {
                if (req.project && req.environments) {
                    for (const env of req.environments) {
                        const key = `${req.project.key}/${env.key}`;
                        if (!byProjectEnv.has(key)) {
                            byProjectEnv.set(key, []);
                        }
                        byProjectEnv.get(key)!.push(req);
                    }
                }
            }

            monthMetric.byProjectEnv = [];
            for (const [key, projectEnvReqs] of Array.from(byProjectEnv.entries()).sort()) {
                const firstReq = projectEnvReqs[0];
                const env = firstReq.environments!.find(e => key.endsWith(e.key))!;

                const projectApproveTimes: number[] = [];
                for (const req of projectEnvReqs) {
                    if (req.reviewStatus === "approved" && req.allReviews) {
                        const approvalReview = req.allReviews.find(r => r.kind === "approve");
                        if (approvalReview) {
                            projectApproveTimes.push(approvalReview.creationDate - req.creationDate);
                        }
                    }
                }

                const projectApplyTimes: number[] = [];
                for (const req of projectEnvReqs) {
                    if (req.status === "completed" && req.reviewStatus === "approved" &&
                        req.appliedDate && req.allReviews) {
                        const approvalReview = req.allReviews.find(r => r.kind === "approve");
                        if (approvalReview) {
                            projectApplyTimes.push(req.appliedDate - approvalReview.creationDate);
                        }
                    }
                }

                monthMetric.byProjectEnv.push({
                    projectKey: firstReq.project!.key,
                    projectName: firstReq.project!.name,
                    envKey: env.key,
                    envName: env.name,
                    avgTimeToApproveMs: projectApproveTimes.length > 0
                        ? projectApproveTimes.reduce((a, b) => a + b, 0) / projectApproveTimes.length
                        : null,
                    avgTimeToApplyMs: projectApplyTimes.length > 0
                        ? projectApplyTimes.reduce((a, b) => a + b, 0) / projectApplyTimes.length
                        : null,
                    totalRequests: projectEnvReqs.length,
                    approvedCount: projectEnvReqs.filter(r => r.reviewStatus === "approved").length,
                    completedCount: projectEnvReqs.filter(r => r.status === "completed").length,
                });
            }

            // Sort by total requests descending
            monthMetric.byProjectEnv.sort((a, b) => b.totalRequests - a.totalRequests);
        }

        metrics.push(monthMetric);
    }

    return metrics;
}

function generateHTML(metrics: MonthlyMetrics[]): string {
    const months = metrics.map(m => m.month);
    const approveTimes = metrics.map(m => m.avgTimeToApproveMs ? m.avgTimeToApproveMs / 1000 / 60 : null);
    const applyTimes = metrics.map(m => m.avgTimeToApplyMs ? m.avgTimeToApplyMs / 1000 / 60 : null);
    const totalRequests = metrics.map(m => m.totalRequests);

    // Reorganize data by project/environment for trend charts
    const projectEnvTrends = new Map<string, {
        projectName: string;
        envName: string;
        months: string[];
        approveTimes: (number | null)[];
        applyTimes: (number | null)[];
        requests: number[];
    }>();

    // Collect all unique project/env combinations and their data over time
    for (const monthMetric of metrics) {
        if (monthMetric.byProjectEnv) {
            for (const pe of monthMetric.byProjectEnv) {
                const key = `${pe.projectKey}/${pe.envKey}`;
                if (!projectEnvTrends.has(key)) {
                    projectEnvTrends.set(key, {
                        projectName: pe.projectName,
                        envName: pe.envName,
                        months: [],
                        approveTimes: [],
                        applyTimes: [],
                        requests: [],
                    });
                }
            }
        }
    }

    // Fill in data for each project/env across all months
    for (const [key, trend] of projectEnvTrends.entries()) {
        for (const monthMetric of metrics) {
            const pe = monthMetric.byProjectEnv?.find(p => `${p.projectKey}/${p.envKey}` === key);
            trend.months.push(monthMetric.month);
            trend.approveTimes.push(pe?.avgTimeToApproveMs ? pe.avgTimeToApproveMs / 1000 / 60 : null);
            trend.applyTimes.push(pe?.avgTimeToApplyMs ? pe.avgTimeToApplyMs / 1000 / 60 : null);
            trend.requests.push(pe?.totalRequests || 0);
        }
    }

    // Sort by total requests descending
    const sortedTrends = Array.from(projectEnvTrends.entries())
        .map(([key, trend]) => ({
            key,
            ...trend,
            totalRequests: trend.requests.reduce((a, b) => a + b, 0),
        }))
        .sort((a, b) => b.totalRequests - a.totalRequests);

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Approval Request Trends</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            margin-top: 0;
            color: #333;
        }
        .chart-container {
            margin: 30px 0;
            position: relative;
            overflow-x: auto;
        }
        .chart {
            display: grid;
            grid-template-columns: 80px 1fr;
            gap: 10px;
            align-items: center;
            margin-bottom: 40px;
            min-width: 600px;
        }
        .y-axis {
            text-align: right;
            font-size: 12px;
            color: #666;
        }
        .chart-area {
            position: relative;
            height: 300px;
            border-left: 2px solid #ddd;
            border-bottom: 2px solid #ddd;
            min-width: 500px;
        }
        .bars {
            display: flex;
            gap: 8px;
            height: 100%;
            align-items: flex-end;
            padding: 0 10px;
        }
        .bar-group {
            flex: 1;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: flex-end;
            height: 100%;
            gap: 4px;
        }
        .bar {
            width: 100%;
            border-radius: 4px 4px 0 0;
            transition: opacity 0.2s;
            cursor: pointer;
        }
        .bar:hover {
            opacity: 0.8;
        }
        .bar-approve {
            background: linear-gradient(180deg, #4f46e5 0%, #6366f1 100%);
        }
        .bar-apply {
            background: linear-gradient(180deg, #10b981 0%, #34d399 100%);
        }
        .bar-requests {
            background: linear-gradient(180deg, #f59e0b 0%, #fbbf24 100%);
        }
        .x-label {
            font-size: 11px;
            color: #666;
            text-align: center;
            margin-top: 4px;
            white-space: nowrap;
        }
        .legend {
            display: flex;
            gap: 30px;
            justify-content: center;
            margin: 20px 0;
        }
        .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
        }
        .legend-color {
            width: 20px;
            height: 20px;
            border-radius: 4px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 30px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background: #f9fafb;
            font-weight: 600;
            color: #374151;
        }
        tr:hover {
            background: #f9fafb;
        }
        .tooltip {
            position: absolute;
            background: rgba(0, 0, 0, 0.9);
            color: white;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 12px;
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.2s;
            z-index: 1000;
        }
        .chart-title {
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 15px;
            color: #374151;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>📊 Approval Request Trends</h1>
        <p style="color: #666;">Analysis of ${metrics.reduce((sum, m) => sum + m.totalRequests, 0).toLocaleString()} approval requests across ${metrics.length} months</p>

        <div class="chart-container">
            <div class="chart-title">Average Time to Approve & Apply (minutes)</div>
            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color bar-approve"></div>
                    <span>Time to Approve</span>
                </div>
                <div class="legend-item">
                    <div class="legend-color bar-apply"></div>
                    <span>Time to Apply</span>
                </div>
            </div>
            <div class="chart">
                <div class="y-axis">
                    <div style="height: 300px; display: flex; flex-direction: column; justify-content: space-between;">
                        ${(() => {
                            const validApproveTimes = approveTimes.filter((t): t is number => t !== null && t > 0);
                            const validApplyTimes = applyTimes.filter((t): t is number => t !== null && t > 0);
                            const maxApprove = validApproveTimes.length > 0 ? Math.max(...validApproveTimes) : 0;
                            const maxApply = validApplyTimes.length > 0 ? Math.max(...validApplyTimes) : 0;
                            const maxTime = Math.max(maxApprove, maxApply, 1);
                            return `<div>${Math.ceil(maxTime)}m</div><div>${Math.ceil(maxTime * 0.5)}m</div><div>0m</div>`;
                        })()}
                    </div>
                </div>
                <div class="chart-area">
                    <div class="bars" id="time-bars"></div>
                </div>
            </div>
        </div>

        <div class="chart-container">
            <div class="chart-title">Total Requests per Month</div>
            <div class="legend">
                <div class="legend-item">
                    <div class="legend-color bar-requests"></div>
                    <span>Total Requests</span>
                </div>
            </div>
            <div class="chart">
                <div class="y-axis">
                    <div style="height: 200px; display: flex; flex-direction: column; justify-content: space-between;">
                        <div>${Math.max(...totalRequests)}</div>
                        <div>${Math.floor(Math.max(...totalRequests) * 0.5)}</div>
                        <div>0</div>
                    </div>
                </div>
                <div class="chart-area" style="height: 200px;">
                    <div class="bars" id="requests-bars"></div>
                </div>
            </div>
        </div>

        <h2>Detailed Metrics</h2>
        <table>
            <thead>
                <tr>
                    <th>Month</th>
                    <th>Avg Time to Approve</th>
                    <th>Avg Time to Apply</th>
                    <th>Total Requests</th>
                    <th>Approved</th>
                    <th>Completed</th>
                </tr>
            </thead>
            <tbody>
                ${metrics.map(m => `
                <tr>
                    <td>${m.month}</td>
                    <td>${formatTime(m.avgTimeToApproveMs)}</td>
                    <td>${formatTime(m.avgTimeToApplyMs)}</td>
                    <td>${m.totalRequests}</td>
                    <td>${m.approvedCount}</td>
                    <td>${m.completedCount}</td>
                </tr>
                `).join('')}
            </tbody>
        </table>

        ${sortedTrends.length > 0 ? `
        <h2 style="margin-top: 40px;">Trends by Project/Environment</h2>
        <p style="color: #666; margin-bottom: 30px;">Showing top 15 project/environment combinations by total requests</p>
        ${sortedTrends.slice(0, 15).map((trend, idx) => `
        <details style="margin: 20px 0; border: 1px solid #e5e7eb; border-radius: 8px; padding: 15px;" ${idx < 5 ? 'open' : ''}>
            <summary style="cursor: pointer; font-weight: 600; font-size: 16px; color: #374151;">
                🏢 ${trend.projectName} / ${trend.envName} <span style="color: #9ca3af; font-weight: normal;">(${trend.totalRequests} total requests)</span>
            </summary>

            <div class="chart-container" style="margin-top: 20px;">
                <div class="chart-title">Average Time to Approve Over Time</div>
                <div class="chart" style="grid-template-columns: 60px 1fr;">
                    <div class="y-axis">
                        <div style="height: 200px; display: flex; flex-direction: column; justify-content: space-between;">
                            ${(() => {
                                const max = Math.max(...trend.approveTimes.filter((t): t is number => t !== null), 0);
                                return `<div>${max.toFixed(0)}m</div><div>${(max * 0.5).toFixed(0)}m</div><div>0m</div>`;
                            })()}
                        </div>
                    </div>
                    <div class="chart-area" style="height: 200px;">
                        <div class="bars" id="approve-${idx}"></div>
                    </div>
                </div>
            </div>

            <div class="chart-container" style="margin-top: 30px;">
                <div class="chart-title">Average Time to Apply Over Time</div>
                <div class="chart" style="grid-template-columns: 60px 1fr;">
                    <div class="y-axis">
                        <div style="height: 200px; display: flex; flex-direction: column; justify-content: space-between;">
                            ${(() => {
                                const max = Math.max(...trend.applyTimes.filter((t): t is number => t !== null), 0);
                                return `<div>${max.toFixed(0)}m</div><div>${(max * 0.5).toFixed(0)}m</div><div>0m</div>`;
                            })()}
                        </div>
                    </div>
                    <div class="chart-area" style="height: 200px;">
                        <div class="bars" id="apply-${idx}"></div>
                    </div>
                </div>
            </div>

            <div class="chart-container" style="margin-top: 30px;">
                <div class="chart-title">Total Requests Over Time</div>
                <div class="chart" style="grid-template-columns: 60px 1fr;">
                    <div class="y-axis">
                        <div style="height: 150px; display: flex; flex-direction: column; justify-content: space-between;">
                            ${(() => {
                                const max = Math.max(...trend.requests);
                                return `<div>${max}</div><div>${Math.floor(max * 0.5)}</div><div>0</div>`;
                            })()}
                        </div>
                    </div>
                    <div class="chart-area" style="height: 150px;">
                        <div class="bars" id="requests-${idx}"></div>
                    </div>
                </div>
            </div>
        </details>
        `).join('')}
        ` : ''}
    </div>

    <div class="tooltip" id="tooltip"></div>

    <script>
        const data = {
            months: ${JSON.stringify(months)},
            approveTimes: ${JSON.stringify(approveTimes)},
            applyTimes: ${JSON.stringify(applyTimes)},
            totalRequests: ${JSON.stringify(totalRequests)},
        };

        const projectEnvTrends = ${JSON.stringify(sortedTrends.slice(0, 15).map(t => ({
            projectName: t.projectName,
            envName: t.envName,
            months: t.months,
            approveTimes: t.approveTimes,
            applyTimes: t.applyTimes,
            requests: t.requests,
        })))};

        // Render time bars
        const timeBars = document.getElementById('time-bars');
        const validApproveTimes = data.approveTimes.filter(t => t !== null && t > 0);
        const validApplyTimes = data.applyTimes.filter(t => t !== null && t > 0);
        const maxApprove = validApproveTimes.length > 0 ? Math.max(...validApproveTimes) : 0;
        const maxApply = validApplyTimes.length > 0 ? Math.max(...validApplyTimes) : 0;
        const maxTime = Math.max(maxApprove, maxApply, 1);

        data.months.forEach((month, i) => {
            const group = document.createElement('div');
            group.className = 'bar-group';

            const approveTime = data.approveTimes[i];
            const applyTime = data.applyTimes[i];

            if (approveTime !== null && approveTime > 0) {
                const approveBar = document.createElement('div');
                approveBar.className = 'bar bar-approve';
                approveBar.style.height = \`\${(approveTime / maxTime * 100)}%\`;
                approveBar.style.minHeight = '4px';
                approveBar.onmouseenter = (e) => showTooltip(e, \`\${month}<br>Approve: \${approveTime.toFixed(1)}m\`);
                approveBar.onmouseleave = hideTooltip;
                group.appendChild(approveBar);
            }

            if (applyTime !== null && applyTime > 0) {
                const applyBar = document.createElement('div');
                applyBar.className = 'bar bar-apply';
                applyBar.style.height = \`\${(applyTime / maxTime * 100)}%\`;
                applyBar.style.minHeight = '4px';
                applyBar.onmouseenter = (e) => showTooltip(e, \`\${month}<br>Apply: \${applyTime.toFixed(1)}m\`);
                applyBar.onmouseleave = hideTooltip;
                group.appendChild(applyBar);
            }

            const label = document.createElement('div');
            label.className = 'x-label';
            label.textContent = month;
            group.appendChild(label);

            timeBars.appendChild(group);
        });

        // Render request bars
        const requestsBars = document.getElementById('requests-bars');
        const maxRequests = Math.max(...data.totalRequests);

        data.months.forEach((month, i) => {
            const group = document.createElement('div');
            group.className = 'bar-group';

            const bar = document.createElement('div');
            bar.className = 'bar bar-requests';
            bar.style.height = \`\${(data.totalRequests[i] / maxRequests * 100)}%\`;
            bar.style.minHeight = '4px';
            bar.onmouseenter = (e) => showTooltip(e, \`\${month}<br>Requests: \${data.totalRequests[i]}\`);
            bar.onmouseleave = hideTooltip;
            group.appendChild(bar);

            const label = document.createElement('div');
            label.className = 'x-label';
            label.textContent = month;
            group.appendChild(label);

            requestsBars.appendChild(group);
        });

        function showTooltip(e, text) {
            const tooltip = document.getElementById('tooltip');
            tooltip.innerHTML = text;
            tooltip.style.opacity = '1';
            tooltip.style.left = e.pageX + 10 + 'px';
            tooltip.style.top = e.pageY - 30 + 'px';
        }

        function hideTooltip() {
            document.getElementById('tooltip').style.opacity = '0';
        }

        // Render project/environment trend charts
        projectEnvTrends.forEach((trend, idx) => {
            // Approve time trend
            const approveBars = document.getElementById(\`approve-\${idx}\`);
            if (approveBars) {
                const validApproveTimes = trend.approveTimes.filter(t => t !== null && t > 0);
                const maxApprove = validApproveTimes.length > 0 ? Math.max(...validApproveTimes) : 1;
                trend.months.forEach((month, i) => {
                    const group = document.createElement('div');
                    group.className = 'bar-group';

                    if (trend.approveTimes[i] !== null && trend.approveTimes[i] > 0) {
                        const bar = document.createElement('div');
                        bar.className = 'bar bar-approve';
                        bar.style.height = \`\${(trend.approveTimes[i] / maxApprove * 100)}%\`;
                        bar.style.minHeight = '4px';
                        bar.onmouseenter = (e) => showTooltip(e, \`\${month}<br>Approve: \${trend.approveTimes[i].toFixed(1)}m\`);
                        bar.onmouseleave = hideTooltip;
                        group.appendChild(bar);
                    }

                    const label = document.createElement('div');
                    label.className = 'x-label';
                    label.textContent = month;
                    group.appendChild(label);

                    approveBars.appendChild(group);
                });
            }

            // Apply time trend
            const applyBars = document.getElementById(\`apply-\${idx}\`);
            if (applyBars) {
                const validApplyTimes = trend.applyTimes.filter(t => t !== null && t > 0);
                const maxApply = validApplyTimes.length > 0 ? Math.max(...validApplyTimes) : 1;
                trend.months.forEach((month, i) => {
                    const group = document.createElement('div');
                    group.className = 'bar-group';

                    if (trend.applyTimes[i] !== null && trend.applyTimes[i] > 0) {
                        const bar = document.createElement('div');
                        bar.className = 'bar bar-apply';
                        bar.style.height = \`\${(trend.applyTimes[i] / maxApply * 100)}%\`;
                        bar.style.minHeight = '4px';
                        bar.onmouseenter = (e) => showTooltip(e, \`\${month}<br>Apply: \${trend.applyTimes[i].toFixed(1)}m\`);
                        bar.onmouseleave = hideTooltip;
                        group.appendChild(bar);
                    }

                    const label = document.createElement('div');
                    label.className = 'x-label';
                    label.textContent = month;
                    group.appendChild(label);

                    applyBars.appendChild(group);
                });
            }

            // Requests trend
            const requestsBars = document.getElementById(\`requests-\${idx}\`);
            if (requestsBars) {
                const maxRequests = Math.max(...trend.requests);
                trend.months.forEach((month, i) => {
                    const group = document.createElement('div');
                    group.className = 'bar-group';

                    const bar = document.createElement('div');
                    bar.className = 'bar bar-requests';
                    bar.style.height = \`\${(trend.requests[i] / maxRequests * 100)}%\`;
                    bar.style.minHeight = '4px';
                    bar.onmouseenter = (e) => showTooltip(e, \`\${month}<br>Requests: \${trend.requests[i]}\`);
                    bar.onmouseleave = hideTooltip;
                    group.appendChild(bar);

                    const label = document.createElement('div');
                    label.className = 'x-label';
                    label.textContent = month;
                    group.appendChild(label);

                    requestsBars.appendChild(group);
                });
            }
        });
    </script>
</body>
</html>`;
}

// Main execution
if (import.meta.main) {
    const args = parseArgs(Deno.args, {
        string: ["input", "format"],
        default: {
            input: "-",
            format: "html",
        },
        alias: {
            i: "input",
            f: "format",
            h: "help",
        },
        boolean: ["help"],
    });

    if (args.help) {
        console.error(`
Usage: analyze-trends.ts [options]

Analyzes approval request trends and outputs JSON or HTML.

Options:
  --input, -i <path>      Input file path, or "-" for stdin (default: stdin)
  --format, -f <format>   Output format: "json" or "html" (default: html)
  --help, -h              Show this help message

Examples:
  # HTML to stdout from stdin
  cat approvals.json | analyze-trends.ts > trends.html

  # HTML from file
  analyze-trends.ts --input approvals.json > trends.html

  # JSON output
  analyze-trends.ts -i approvals.json -f json > metrics.json
`);
        Deno.exit(0);
    }

    const inputSource = args.input;
    const outputFormat = args.format;

    if (outputFormat !== "json" && outputFormat !== "html") {
        console.error(`❌ Error: --format must be "json" or "html" (got: ${outputFormat})`);
        Deno.exit(1);
    }

    // Read input
    let content: string;
    if (inputSource === "-") {
        console.error(`📊 Analyzing trends from stdin`);
        const decoder = new TextDecoder();
        const buf = new Uint8Array(1024 * 1024); // 1MB buffer
        let result = "";
        while (true) {
            const n = await Deno.stdin.read(buf);
            if (n === null) break;
            result += decoder.decode(buf.subarray(0, n));
        }
        content = result;
    } else {
        console.error(`📊 Analyzing trends from: ${inputSource}`);
        content = await Deno.readTextFile(inputSource);
    }

    const lines = content.trim().split('\n');
    const requests: ApprovalRequest[] = lines
        .filter(line => line.trim())
        .map(line => JSON.parse(line));

    console.error(`   Found ${requests.length} approval requests`);

    // Check if data has project/environment info for breakdown
    const hasProjectEnv = requests.some(r => r.project && r.environments);
    if (hasProjectEnv) {
        console.error(`   ✓ Project/environment data detected - enabling breakdown view`);
    }

    // Calculate metrics
    const metrics = calculateMonthlyMetrics(requests, hasProjectEnv);
    console.error(`   Analyzed ${metrics.length} months`);

    // Output based on format
    if (outputFormat === "json") {
        console.log(JSON.stringify(metrics, null, 2));
        console.error(`✅ Generated JSON report`);
    } else {
        const html = generateHTML(metrics);
        console.log(html);
        console.error(`✅ Generated HTML report`);
    }
}
