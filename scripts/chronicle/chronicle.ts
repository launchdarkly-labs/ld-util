#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read

import { getAllAuditLogEntries } from "../get-all-audit-log-entries/get-all-audit-log-entries.ts";

// ============================================================================
// Type Definitions
// ============================================================================

interface AuditLogEntry {
    _id: string;
    _accountId: string;
    date: number;
    accesses: Array<{
        action: string;
        resource: string;
    }>;
    kind: string;
    name?: string;
    member?: {
        _id: string;
        email: string;
        firstName: string;
        lastName: string;
    };
    token?: {
        _id: string;
        name: string;
    };
    target?: {
        resources?: string[];
        name?: string;
    };
}

interface CallerIdentity {
    _id: string;
    email: string;
    role: string;
}

interface MemberDetails {
    _id: string;
    email: string;
    firstName: string;
    lastName: string;
}

interface ChronicleStats {
    flagsCreated: number;
    flagsArchived: number;
    flagUpdates: number;
    experimentsCreated: number;
    segmentsCreated: number;
    approvals: {
        created: number;
        reviewed: number;
        applied: number;
        speed: ApprovalSpeed | null;
    };
    releasePipelines: {
        created: number;
        used: number;
    };
    integrationsCreated: number;
    guardedRollouts: number;
    projectsWorkedOn: string[];
    totalProjects: number;
    peakActivity: {
        month: string;
        count: number;
        day: string;
        dayCount: number;
        hour: number;
        hourCount: number;
    };
    remediation: {
        fastestSeconds: number;
        fastestFlag: string;
        totalIncidents: number;
        averageSeconds: number;
    } | null;
    oops: {
        fastestSeconds: number;
        fastestFlag: string;
        totalRollbacks: number;
    } | null;
    insights: {
        longestStreak: number;
        weekendWarrior: boolean;
        nightOwl: boolean;
        earlyBird: boolean;
        cleanupCrew: boolean;
        topEnvironment: string;
        productionChanges: number;
    };
}

interface Collaborator {
    memberId: string;
    email: string;
    name: string;
    sharedFlags: number;
}

interface Ranking {
    rank: number;
    total: number;
    percentile: number;
    above?: {
        memberId: string;
        name: string;
        count: number;
    };
    below?: {
        memberId: string;
        name: string;
        count: number;
    };
    topCreators: Array<{
        memberId: string;
        name: string;
        count: number;
    }>;
}

interface Achievement {
    name: string;
    description: string;
    earned: boolean;
    rank?: number;
    value?: number | string;
}

interface ApprovalSpeed {
    fastestSeconds: number;
    fastestApprovalId: string;
    averageSeconds: number;
    totalApprovals: number;
}

interface ChronicleReport {
    user: {
        memberId: string;
        email: string;
        firstName: string;
        lastName: string;
    };
    year: number;
    stats: ChronicleStats;
    collaborators: Collaborator[];
    rankings: {
        flagsCreated: Ranking;
    };
    achievements: Achievement[];
}

// ============================================================================
// API Helper Functions
// ============================================================================

async function getCallerIdentity(apiKey: string): Promise<CallerIdentity> {
    const baseUrl = "https://app.launchdarkly.com/";
    const url = new URL("/api/v2/caller-identity", baseUrl);

    const response = await fetch(url, {
        headers: {
            "Authorization": apiKey,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        throw new Error(
            `Failed to get caller identity: ${response.status} ${response.statusText}`,
        );
    }

    const data = await response.json();
    // The API returns memberId field which we need
    return {
        _id: data.memberId,
        email: data.email || "",
        role: data.role || "",
    };
}

async function getMemberDetails(
    apiKey: string,
    memberId: string,
): Promise<MemberDetails> {
    const baseUrl = "https://app.launchdarkly.com/";
    const url = new URL(`/api/v2/members/${memberId}`, baseUrl);

    const response = await fetch(url, {
        headers: {
            "Authorization": apiKey,
            "Content-Type": "application/json",
        },
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
            `Failed to get member details for ${memberId}: ${response.status} ${response.statusText} - ${errorText}`,
        );
    }

    return await response.json();
}

// ============================================================================
// Input Processing Functions
// ============================================================================

async function* readAuditLogFromFile(
    filePath: string,
): AsyncGenerator<AuditLogEntry> {
    const file = await Deno.open(filePath, { read: true });
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        for await (const chunk of file.readable) {
            buffer += decoder.decode(chunk, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        yield JSON.parse(line);
                    } catch (error) {
                        console.error(`Failed to parse line: ${error.message}`);
                    }
                }
            }
        }

        // Process remaining buffer
        if (buffer.trim()) {
            try {
                yield JSON.parse(buffer);
            } catch (error) {
                console.error(`Failed to parse line: ${error.message}`);
            }
        }
    } finally {
        try {
            file.close();
        } catch {
            // File may already be closed, ignore
        }
    }
}

async function* fetchAuditLogFromAPI(
    apiKey: string,
    year: number,
): AsyncGenerator<AuditLogEntry> {
    // Calculate start of year (Jan 1 00:00:00 UTC)
    const startOfYear = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0)).getTime();
    // Calculate end of year (Dec 31 23:59:59 UTC)
    const endOfYear = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999))
        .getTime();

    for await (
        const entry of getAllAuditLogEntries(apiKey, {
            after: startOfYear,
            before: endOfYear,
        })
    ) {
        yield entry as AuditLogEntry;
    }
}

// ============================================================================
// Statistics Calculation Functions
// ============================================================================

function extractProjectKey(resource: string): string | null {
    const match = resource.match(/proj\/([^:]+):/);
    if (!match) return null;

    // Strip tags (everything after semicolon)
    const projectKeyWithTags = match[1];
    const projectKey = projectKeyWithTags.split(';')[0];
    return projectKey;
}

function calculateUserStats(
    userEntries: AuditLogEntry[],
): ChronicleStats {
    const stats: ChronicleStats = {
        flagsCreated: 0,
        flagsArchived: 0,
        flagUpdates: 0,
        experimentsCreated: 0,
        segmentsCreated: 0,
        approvals: {
            created: 0,
            reviewed: 0,
            applied: 0,
            speed: null,
        },
        releasePipelines: {
            created: 0,
            used: 0,
        },
        integrationsCreated: 0,
        guardedRollouts: 0,
        projectsWorkedOn: [],
        totalProjects: 0,
        peakActivity: {
            month: "",
            count: 0,
            day: "",
            dayCount: 0,
            hour: 0,
            hourCount: 0,
        },
        remediation: null,
        oops: null,
        insights: {
            longestStreak: 0,
            weekendWarrior: false,
            nightOwl: false,
            earlyBird: false,
            cleanupCrew: false,
            topEnvironment: "",
            productionChanges: 0,
        },
    };

    const projectSet = new Set<string>();
    const monthCounts = new Map<string, number>();
    const dayCounts = new Map<string, number>();
    const hourCounts = new Map<number, number>();
    const dateSet = new Set<string>();
    const environmentCounts = new Map<string, number>();

    // Track flag on/off events for remediation
    const flagEvents: Map<string, Array<{ date: number; action: string; titleVerb: string }>> = new Map();

    const monthNames = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];

    let weekendCount = 0;
    let nightCount = 0;
    let earlyMorningCount = 0;

    for (const entry of userEntries) {
        const actions = entry.accesses.map((a) => a.action);
        const date = new Date(entry.date);
        const hour = date.getUTCHours();
        const dayOfWeek = date.getUTCDay();

        // Count flag operations
        if (entry.kind === "flag") {
            if (actions.some((a) => a.includes("createFlag"))) {
                stats.flagsCreated++;
            }

            if (
                actions.some((a) =>
                    a.includes("archiveFlag") || a.includes("deleteFlag")
                )
            ) {
                stats.flagsArchived++;
            }

            if (
                actions.some((a) =>
                    a.includes("update") && !a.includes("MeasuredRollout")
                )
            ) {
                stats.flagUpdates++;
            }

            // Track flag on/off for remediation
            if (actions.some((a) => a === "updateOn") && entry.titleVerb && entry.name) {
                const flagKey = entry.name;
                if (!flagEvents.has(flagKey)) {
                    flagEvents.set(flagKey, []);
                }
                flagEvents.get(flagKey)!.push({
                    date: entry.date,
                    action: "updateOn",
                    titleVerb: entry.titleVerb,
                });
            }
        }

        // Experiments
        if (entry.kind === "experiment" || actions.some((a) => a.includes("createExperiment"))) {
            if (actions.some((a) => a.includes("createExperiment"))) {
                stats.experimentsCreated++;
            }
        }

        // Segments
        if (entry.kind === "segment" || actions.some((a) => a.includes("Segment"))) {
            if (actions.some((a) => a.includes("createSegment"))) {
                stats.segmentsCreated++;
            }
        }

        // Approvals
        if (actions.some((a) => a.includes("createApprovalRequest"))) {
            stats.approvals.created++;
        }
        if (actions.some((a) => a.includes("reviewApprovalRequest"))) {
            stats.approvals.reviewed++;
        }
        if (actions.some((a) => a.includes("applyApprovalRequest"))) {
            stats.approvals.applied++;
        }

        // Release Pipelines
        if (actions.some((a) => a.includes("createReleasePipeline"))) {
            stats.releasePipelines.created++;
        }
        if (actions.some((a) => a.includes("addReleasePipeline") || a.includes("updateReleasePhaseStatus"))) {
            stats.releasePipelines.used++;
        }

        // Integrations
        if (actions.some((a) => a.includes("createIntegration"))) {
            stats.integrationsCreated++;
        }

        // Guarded rollouts
        if (actions.some((a) => a.includes("MeasuredRollout"))) {
            stats.guardedRollouts++;
        }

        // Extract projects
        if (entry.target?.resources) {
            for (const resource of entry.target.resources) {
                const projectKey = extractProjectKey(resource);
                if (projectKey) {
                    projectSet.add(projectKey);
                }

                // Track environment
                const envMatch = resource.match(/env\/([^:;]+)/);
                if (envMatch) {
                    const env = envMatch[1];
                    environmentCounts.set(env, (environmentCounts.get(env) || 0) + 1);
                    if (env === "production") {
                        stats.insights.productionChanges++;
                    }
                }
            }
        }

        // Track activity patterns
        const monthKey = `${date.getUTCFullYear()}-${
            String(date.getUTCMonth()).padStart(2, "0")
        }`;
        const dayKey = date.toISOString().split("T")[0];

        monthCounts.set(monthKey, (monthCounts.get(monthKey) || 0) + 1);
        dayCounts.set(dayKey, (dayCounts.get(dayKey) || 0) + 1);
        hourCounts.set(hour, (hourCounts.get(hour) || 0) + 1);
        dateSet.add(dayKey);

        // Weekend activity (Saturday = 6, Sunday = 0)
        if (dayOfWeek === 0 || dayOfWeek === 6) {
            weekendCount++;
        }

        // Night owl (10 PM - 4 AM)
        if (hour >= 22 || hour < 4) {
            nightCount++;
        }

        // Early bird (5 AM - 8 AM)
        if (hour >= 5 && hour < 8) {
            earlyMorningCount++;
        }
    }

    // Calculate remediation stats (off → on)
    stats.remediation = calculateRemediation(flagEvents);

    // Calculate oops stats (on → off)
    stats.oops = calculateOops(flagEvents);

    // Calculate insights
    stats.insights.longestStreak = calculateLongestStreak(dateSet);
    stats.insights.weekendWarrior = weekendCount > 50; // More than 50 weekend actions
    stats.insights.nightOwl = nightCount > userEntries.length * 0.2; // More than 20% at night
    stats.insights.earlyBird = earlyMorningCount > userEntries.length * 0.15; // More than 15% early morning
    stats.insights.cleanupCrew = stats.flagsArchived > stats.flagsCreated * 0.5; // Archived more than 50% of created

    // Find top environment
    let topEnv = "";
    let topEnvCount = 0;
    for (const [env, count] of environmentCounts.entries()) {
        if (count > topEnvCount) {
            topEnvCount = count;
            topEnv = env;
        }
    }
    stats.insights.topEnvironment = topEnv;

    // Find peak month
    let peakMonth = "";
    let peakMonthCount = 0;
    for (const [month, count] of monthCounts.entries()) {
        if (count > peakMonthCount) {
            peakMonthCount = count;
            peakMonth = month;
        }
    }

    // Find peak day
    let peakDay = "";
    let peakDayCount = 0;
    for (const [day, count] of dayCounts.entries()) {
        if (count > peakDayCount) {
            peakDayCount = count;
            peakDay = day;
        }
    }

    // Find peak hour
    let peakHour = 0;
    let peakHourCount = 0;
    for (const [hour, count] of hourCounts.entries()) {
        if (count > peakHourCount) {
            peakHourCount = count;
            peakHour = hour;
        }
    }

    stats.projectsWorkedOn = Array.from(projectSet).sort();
    stats.totalProjects = stats.projectsWorkedOn.length;

    if (peakMonth) {
        const [year, month] = peakMonth.split("-");
        stats.peakActivity.month = monthNames[parseInt(month)];
        stats.peakActivity.count = peakMonthCount;
    }

    if (peakDay) {
        stats.peakActivity.day = peakDay;
        stats.peakActivity.dayCount = peakDayCount;
    }

    stats.peakActivity.hour = peakHour;
    stats.peakActivity.hourCount = peakHourCount;

    return stats;
}

function calculateRemediation(
    flagEvents: Map<string, Array<{ date: number; action: string; titleVerb: string }>>,
): {
    fastestSeconds: number;
    fastestFlag: string;
    totalIncidents: number;
    averageSeconds: number;
} | null {
    const remediations: Array<{ flagKey: string; seconds: number }> = [];

    for (const [flagKey, events] of flagEvents.entries()) {
        // Sort events by date
        events.sort((a, b) => a.date - b.date);

        for (let i = 0; i < events.length - 1; i++) {
            const current = events[i];
            const next = events[i + 1];

            // Check if this is a "turned off" followed by "turned on" (remediation)
            if (
                current.titleVerb.startsWith("turned off") &&
                next.titleVerb.startsWith("turned on")
            ) {
                const seconds = (next.date - current.date) / 1000;
                remediations.push({ flagKey, seconds });
            }
        }
    }

    if (remediations.length === 0) {
        return null;
    }

    // Find fastest
    const fastest = remediations.reduce((min, curr) =>
        curr.seconds < min.seconds ? curr : min
    );

    // Calculate average
    const totalSeconds = remediations.reduce((sum, r) => sum + r.seconds, 0);
    const averageSeconds = totalSeconds / remediations.length;

    return {
        fastestSeconds: Math.round(fastest.seconds),
        fastestFlag: fastest.flagKey,
        totalIncidents: remediations.length,
        averageSeconds: Math.round(averageSeconds),
    };
}

function calculateOops(
    flagEvents: Map<string, Array<{ date: number; action: string; titleVerb: string }>>,
): {
    fastestSeconds: number;
    fastestFlag: string;
    totalRollbacks: number;
} | null {
    const rollbacks: Array<{ flagKey: string; seconds: number }> = [];

    for (const [flagKey, events] of flagEvents.entries()) {
        // Sort events by date
        events.sort((a, b) => a.date - b.date);

        for (let i = 0; i < events.length - 1; i++) {
            const current = events[i];
            const next = events[i + 1];

            // Check if this is a "turned on" followed by "turned off" (rollback/oops)
            if (
                current.titleVerb.startsWith("turned on") &&
                next.titleVerb.startsWith("turned off")
            ) {
                const seconds = (next.date - current.date) / 1000;
                rollbacks.push({ flagKey, seconds });
            }
        }
    }

    if (rollbacks.length === 0) {
        return null;
    }

    // Find fastest rollback
    const fastest = rollbacks.reduce((min, curr) =>
        curr.seconds < min.seconds ? curr : min
    );

    return {
        fastestSeconds: Math.round(fastest.seconds),
        fastestFlag: fastest.flagKey,
        totalRollbacks: rollbacks.length,
    };
}

function calculateLongestStreak(dateSet: Set<string>): number {
    if (dateSet.size === 0) return 0;

    const dates = Array.from(dateSet).sort();
    let longestStreak = 1;
    let currentStreak = 1;

    for (let i = 1; i < dates.length; i++) {
        const prevDate = new Date(dates[i - 1]);
        const currDate = new Date(dates[i]);

        // Calculate difference in days
        const diffMs = currDate.getTime() - prevDate.getTime();
        const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

        if (diffDays === 1) {
            currentStreak++;
            longestStreak = Math.max(longestStreak, currentStreak);
        } else {
            currentStreak = 1;
        }
    }

    return longestStreak;
}

function findCollaborators(
    userEntries: AuditLogEntry[],
    allEntries: AuditLogEntry[],
    userId: string,
    memberCache: Map<string, MemberDetails>,
): Collaborator[] {
    // Extract all flag keys the user touched
    const userFlagKeys = new Set<string>();
    for (const entry of userEntries) {
        if (entry.kind === "flag" && entry.target?.resources) {
            for (const resource of entry.target.resources) {
                // Extract flag key from resource like "proj/X:env/Y:flag/Z"
                const match = resource.match(/flag\/([^;]+)/);
                if (match) {
                    userFlagKeys.add(match[1]);
                }
            }
        }
    }

    // Find other members who modified the same flags
    const collaboratorCounts = new Map<string, number>();

    for (const entry of allEntries) {
        if (
            entry.kind === "flag" && entry.member &&
            entry.member._id !== userId && entry.target?.resources
        ) {
            for (const resource of entry.target.resources) {
                const match = resource.match(/flag\/([^;]+)/);
                if (match && userFlagKeys.has(match[1])) {
                    const memberId = entry.member._id;
                    collaboratorCounts.set(
                        memberId,
                        (collaboratorCounts.get(memberId) || 0) + 1,
                    );
                }
            }
        }
    }

    // Convert to collaborator objects and sort by count
    const collaborators: Collaborator[] = [];
    for (const [memberId, count] of collaboratorCounts.entries()) {
        const member = memberCache.get(memberId);
        if (member) {
            collaborators.push({
                memberId: member._id,
                email: member.email,
                name: `${member.firstName} ${member.lastName}`,
                sharedFlags: count,
            });
        }
    }

    return collaborators.sort((a, b) => b.sharedFlags - a.sharedFlags);
}

function calculateAchievements(
    userId: string,
    userStats: ChronicleStats,
    allEntries: AuditLogEntry[],
    collaborators: Collaborator[],
): Achievement[] {
    const achievements: Achievement[] = [];

    // Calculate stats for all members
    const memberStats = new Map<string, {
        flagsCreated: number;
        flagsArchived: number;
        fastestRemediation: number;
        fastestOops: number;
        fridayActions: number;
        projects: Set<string>;
        collaborators: Set<string>;
        peakDayCount: number;
        peakHourCount: number;
        remediationCount: number;
        rollbackCount: number;
        environments: Set<string>;
        monthsActive: Set<number>;
        activityTypes: Set<string>;
        approvalTotal: number;
        approvalThroughProcess: number;
    }>();

    // Track first events of the year
    let firstFlagCreated: { memberId: string; date: number; flagName: string } | null = null;
    let firstFlagTurnedOn: { memberId: string; date: number; flagName: string } | null = null;
    let firstGuardedRollout: { memberId: string; date: number; flagName: string } | null = null;

    for (const entry of allEntries) {
        if (!entry.member) continue;
        const memberId = entry.member._id;

        if (!memberStats.has(memberId)) {
            memberStats.set(memberId, {
                flagsCreated: 0,
                flagsArchived: 0,
                fastestRemediation: Infinity,
                fastestOops: Infinity,
                fridayActions: 0,
                projects: new Set(),
                collaborators: new Set(),
                peakDayCount: 0,
                peakHourCount: 0,
                remediationCount: 0,
                rollbackCount: 0,
                environments: new Set(),
                monthsActive: new Set(),
                activityTypes: new Set(),
                approvalTotal: 0,
                approvalThroughProcess: 0,
            });
        }

        const stats = memberStats.get(memberId)!;
        const actions = entry.accesses.map((a) => a.action);

        // Track Friday activity (Friday = 5)
        const entryDate = new Date(entry.date);
        if (entryDate.getUTCDay() === 5) {
            stats.fridayActions++;
        }

        // Track month active
        stats.monthsActive.add(entryDate.getUTCMonth());

        // Track activity types
        if (entry.kind === "flag") stats.activityTypes.add("flags");
        if (entry.kind === "experiment") stats.activityTypes.add("experiments");
        if (entry.kind === "segment") stats.activityTypes.add("segments");
        if (actions.some(a => a.includes("Approval"))) stats.activityTypes.add("approvals");
        if (actions.some(a => a.includes("ReleasePipeline"))) stats.activityTypes.add("pipelines");

        // Track projects and environments
        if (entry.target?.resources) {
            for (const resource of entry.target.resources) {
                const projectKey = extractProjectKey(resource);
                if (projectKey) {
                    stats.projects.add(projectKey);
                }

                const envMatch = resource.match(/env\/([^:;]+)/);
                if (envMatch) {
                    stats.environments.add(envMatch[1]);
                }
            }
        }

        // Track approvals
        if (actions.some(a => a.includes("createApprovalRequest"))) {
            stats.approvalTotal++;
        }
        if (actions.some(a => a.includes("reviewApprovalRequest"))) {
            stats.approvalThroughProcess++;
        }

        if (entry.kind === "flag") {
            if (actions.some((a) => a.includes("createFlag"))) {
                stats.flagsCreated++;

                // Track first flag created
                if (!firstFlagCreated || entry.date < firstFlagCreated.date) {
                    firstFlagCreated = {
                        memberId,
                        date: entry.date,
                        flagName: entry.name || "Unknown",
                    };
                }
            }

            if (actions.some((a) => a.includes("archiveFlag") || a.includes("deleteFlag"))) {
                stats.flagsArchived++;
            }

            // Track first flag turned on
            if (
                actions.some((a) => a === "updateOn") &&
                entry.titleVerb?.startsWith("turned on")
            ) {
                if (!firstFlagTurnedOn || entry.date < firstFlagTurnedOn.date) {
                    firstFlagTurnedOn = {
                        memberId,
                        date: entry.date,
                        flagName: entry.name || "Unknown",
                    };
                }
            }

            // Track first guarded rollout
            if (actions.some((a) => a.includes("MeasuredRollout"))) {
                if (!firstGuardedRollout || entry.date < firstGuardedRollout.date) {
                    firstGuardedRollout = {
                        memberId,
                        date: entry.date,
                        flagName: entry.name || "Unknown",
                    };
                }
            }
        }
    }

    // Captain Cleanup - Most flags archived
    const sortedByArchived = Array.from(memberStats.entries())
        .sort((a, b) => b[1].flagsArchived - a[1].flagsArchived);
    const archivedRank = sortedByArchived.findIndex(([id]) => id === userId) + 1;

    if (archivedRank === 1 && userStats.flagsArchived > 0) {
        achievements.push({
            name: "🧹 Captain Cleanup",
            description: `Archived the most flags in your team (${userStats.flagsArchived} flags)`,
            earned: true,
            rank: 1,
            value: userStats.flagsArchived,
        });
    } else if (archivedRank <= 3 && userStats.flagsArchived > 0) {
        achievements.push({
            name: "🧹 Cleanup Crew",
            description: `#${archivedRank} most flags archived (${userStats.flagsArchived} flags)`,
            earned: true,
            rank: archivedRank,
            value: userStats.flagsArchived,
        });
    }

    // Lightning Fast - Fastest remediation
    if (userStats.remediation && userStats.remediation.fastestSeconds < 60) {
        const allRemediations: number[] = [];
        // Would need to calculate this for all users, but for now check if user is fast
        if (userStats.remediation.fastestSeconds < 10) {
            achievements.push({
                name: "⚡ Lightning Fast",
                description: `Fastest flag remediation: ${userStats.remediation.fastestSeconds}s on "${userStats.remediation.fastestFlag}"`,
                earned: true,
                value: `${userStats.remediation.fastestSeconds}s`,
            });
        }
    }

    // Oops! - Fastest rollback
    if (userStats.oops && userStats.oops.fastestSeconds < 300) {
        achievements.push({
            name: "😅 Oops!",
            description: `Quick rollback: Turned off "${userStats.oops.fastestFlag}" ${userStats.oops.fastestSeconds}s after turning it on`,
            earned: true,
            value: `${userStats.oops.fastestSeconds}s`,
        });
    }

    // Governance Guru - Lots of approval reviews
    if (userStats.approvals.reviewed >= 50) {
        achievements.push({
            name: "🛡️ Governance Guru",
            description: `Reviewed ${userStats.approvals.reviewed} approval requests`,
            earned: true,
            value: userStats.approvals.reviewed,
        });
    } else if (userStats.approvals.reviewed >= 20) {
        achievements.push({
            name: "✅ Approval Pro",
            description: `Reviewed ${userStats.approvals.reviewed} approval requests`,
            earned: true,
            value: userStats.approvals.reviewed,
        });
    }

    // Experiment Enthusiast
    if (userStats.experimentsCreated >= 20) {
        achievements.push({
            name: "🧪 Experiment Enthusiast",
            description: `Ran ${userStats.experimentsCreated} experiments`,
            earned: true,
            value: userStats.experimentsCreated,
        });
    } else if (userStats.experimentsCreated >= 10) {
        achievements.push({
            name: "🧪 Testing the Waters",
            description: `Ran ${userStats.experimentsCreated} experiments`,
            earned: true,
            value: userStats.experimentsCreated,
        });
    }

    // Segment Master
    if (userStats.segmentsCreated >= 50) {
        achievements.push({
            name: "🎯 Segment Master",
            description: `Created ${userStats.segmentsCreated} segments`,
            earned: true,
            value: userStats.segmentsCreated,
        });
    } else if (userStats.segmentsCreated >= 20) {
        achievements.push({
            name: "🎯 Targeting Pro",
            description: `Created ${userStats.segmentsCreated} segments`,
            earned: true,
            value: userStats.segmentsCreated,
        });
    }

    // Safe Hands - Lots of guarded rollouts
    if (userStats.guardedRollouts >= 20) {
        achievements.push({
            name: "🛡️ Safe Hands",
            description: `Used ${userStats.guardedRollouts} guarded rollouts`,
            earned: true,
            value: userStats.guardedRollouts,
        });
    }

    // Release Pipeline Pro
    if (userStats.releasePipelines.created >= 10) {
        achievements.push({
            name: "🚀 Pipeline Builder",
            description: `Created ${userStats.releasePipelines.created} release pipelines`,
            earned: true,
            value: userStats.releasePipelines.created,
        });
    }

    // Steady Eddie - Long streak
    if (userStats.insights.longestStreak >= 30) {
        achievements.push({
            name: "🔥 On Fire",
            description: `${userStats.insights.longestStreak}-day activity streak`,
            earned: true,
            value: `${userStats.insights.longestStreak} days`,
        });
    } else if (userStats.insights.longestStreak >= 14) {
        achievements.push({
            name: "📈 Steady Eddie",
            description: `${userStats.insights.longestStreak}-day activity streak`,
            earned: true,
            value: `${userStats.insights.longestStreak} days`,
        });
    }

    // Production Pro
    if (userStats.insights.productionChanges >= 500) {
        achievements.push({
            name: "⚙️ Production Pro",
            description: `Made ${userStats.insights.productionChanges} production changes`,
            earned: true,
            value: userStats.insights.productionChanges,
        });
    }

    // Night Owl / Early Bird / Weekend Warrior
    if (userStats.insights.nightOwl) {
        achievements.push({
            name: "🦉 Night Owl",
            description: "More than 20% of activity between 10 PM - 4 AM",
            earned: true,
        });
    }

    if (userStats.insights.earlyBird) {
        achievements.push({
            name: "🌅 Early Bird",
            description: "More than 15% of activity between 5 AM - 8 AM",
            earned: true,
        });
    }

    if (userStats.insights.weekendWarrior) {
        achievements.push({
            name: "⚔️ Weekend Warrior",
            description: "More than 50 weekend actions",
            earned: true,
        });
    }

    // First of the year achievements
    if (firstFlagCreated && firstFlagCreated.memberId === userId) {
        const date = new Date(firstFlagCreated.date);
        achievements.push({
            name: "🎉 First Flag of the Year",
            description: `Created the first flag of the year: "${firstFlagCreated.flagName}" on ${date.toLocaleDateString()}`,
            earned: true,
            value: firstFlagCreated.flagName,
        });
    }

    if (firstFlagTurnedOn && firstFlagTurnedOn.memberId === userId) {
        const date = new Date(firstFlagTurnedOn.date);
        achievements.push({
            name: "💡 First Light",
            description: `Turned on the first flag of the year: "${firstFlagTurnedOn.flagName}" on ${date.toLocaleDateString()}`,
            earned: true,
            value: firstFlagTurnedOn.flagName,
        });
    }

    if (firstGuardedRollout && firstGuardedRollout.memberId === userId) {
        const date = new Date(firstGuardedRollout.date);
        achievements.push({
            name: "🛡️ Safety First",
            description: `First guarded rollout of the year: "${firstGuardedRollout.flagName}" on ${date.toLocaleDateString()}`,
            earned: true,
            value: firstGuardedRollout.flagName,
        });
    }

    // Friday Warrior - Most changes on Friday
    const sortedByFriday = Array.from(memberStats.entries())
        .sort((a, b) => b[1].fridayActions - a[1].fridayActions);
    const fridayRank = sortedByFriday.findIndex(([id]) => id === userId) + 1;
    const userFridayCount = memberStats.get(userId)?.fridayActions || 0;

    if (fridayRank === 1 && userFridayCount > 0) {
        achievements.push({
            name: "🎉 Friday Warrior",
            description: `Most active on Fridays in your team (${userFridayCount} Friday actions)`,
            earned: true,
            rank: 1,
            value: userFridayCount,
        });
    } else if (fridayRank <= 3 && userFridayCount > 50) {
        achievements.push({
            name: "🎊 Friday Fan",
            description: `#${fridayRank} most active on Fridays (${userFridayCount} actions)`,
            earned: true,
            rank: fridayRank,
            value: userFridayCount,
        });
    }

    // Get user stats for achievement checks
    const userMemberStats = memberStats.get(userId);
    if (!userMemberStats) return achievements;

    // Milestone Achievements
    if (userStats.flagsCreated >= 100) {
        achievements.push({
            name: "💯 Century Club",
            description: `Created ${userStats.flagsCreated} flags!`,
            earned: true,
            value: userStats.flagsCreated,
        });
    }

    if (userStats.segmentsCreated >= 100 || userStats.approvals.reviewed >= 100) {
        const type = userStats.segmentsCreated >= 100 ? "segments" : "approvals reviewed";
        const count = userStats.segmentsCreated >= 100 ? userStats.segmentsCreated : userStats.approvals.reviewed;
        achievements.push({
            name: "🏅 Triple Digit",
            description: `Hit 100+ ${type} (${count})`,
            earned: true,
            value: count,
        });
    }

    // Social Butterfly - Most collaborators
    const collaboratorCount = collaborators.length;
    const sortedByCollaborators = Array.from(memberStats.entries())
        .map(([id, stats]) => ({ id, count: stats.collaborators.size }))
        .sort((a, b) => b.count - a.count);
    const collaboratorRank = sortedByCollaborators.findIndex(x => x.id === userId) + 1;

    if (collaboratorRank === 1 && collaboratorCount >= 5) {
        achievements.push({
            name: "🦋 Social Butterfly",
            description: `Most collaborators in your team (${collaboratorCount} teammates)`,
            earned: true,
            rank: 1,
            value: collaboratorCount,
        });
    }

    // Lone Wolf - Few collaborators but productive
    if (collaboratorCount <= 2 && userStats.flagsCreated >= 20) {
        achievements.push({
            name: "🐺 Lone Wolf",
            description: `Shipped ${userStats.flagsCreated} flags mostly solo`,
            earned: true,
            value: userStats.flagsCreated,
        });
    }

    // Project Hopper vs Specialist
    const projectCount = userStats.totalProjects;
    const sortedByProjects = Array.from(memberStats.entries())
        .map(([id, stats]) => ({ id, count: stats.projects.size }))
        .sort((a, b) => b.count - a.count);
    const projectRank = sortedByProjects.findIndex(x => x.id === userId) + 1;

    if (projectRank === 1 && projectCount >= 10) {
        achievements.push({
            name: "🗺️ Project Hopper",
            description: `Worked on the most projects (${projectCount} projects)`,
            earned: true,
            rank: 1,
            value: projectCount,
        });
    } else if (projectCount <= 3 && userStats.flagsCreated >= 20) {
        achievements.push({
            name: "🎯 Specialist",
            description: `Deep focus on ${projectCount} project${projectCount > 1 ? 's' : ''}`,
            earned: true,
            value: projectCount,
        });
    }

    // Jack of All Trades - Multiple activity types
    const activityTypeCount = userMemberStats.activityTypes.size;
    if (activityTypeCount >= 5) {
        achievements.push({
            name: "🃏 Jack of All Trades",
            description: `Active in ${activityTypeCount} different areas: ${Array.from(userMemberStats.activityTypes).join(', ')}`,
            earned: true,
            value: activityTypeCount,
        });
    }

    // Polyglot - All environments
    const envCount = userMemberStats.environments.size;
    if (envCount >= 5) {
        achievements.push({
            name: "🌐 Polyglot",
            description: `Worked across ${envCount} environments`,
            earned: true,
            value: envCount,
        });
    } else if (envCount >= 3) {
        achievements.push({
            name: "🌍 Multi-Environment",
            description: `Active in ${envCount} environments`,
            earned: true,
            value: envCount,
        });
    }

    // Perfect Attendance - All 12 months
    const monthsActiveCount = userMemberStats.monthsActive.size;
    if (monthsActiveCount === 12) {
        achievements.push({
            name: "📅 Perfect Attendance",
            description: "Active in all 12 months of the year",
            earned: true,
            value: 12,
        });
    } else if (monthsActiveCount >= 10) {
        achievements.push({
            name: "📆 Consistent Contributor",
            description: `Active in ${monthsActiveCount} months`,
            earned: true,
            value: monthsActiveCount,
        });
    }

    // Firefighter - Most remediations
    if (userStats.remediation && userStats.remediation.totalIncidents >= 20) {
        const sortedByRemediations = Array.from(memberStats.entries())
            .map(([id, stats]) => ({ id, count: stats.remediationCount }))
            .sort((a, b) => b.count - a.count);
        const remediationRank = sortedByRemediations.findIndex(x => x.id === userId) + 1;

        if (remediationRank === 1) {
            achievements.push({
                name: "🔥 Firefighter",
                description: `Handled the most incidents (${userStats.remediation.totalIncidents} remediations)`,
                earned: true,
                rank: 1,
                value: userStats.remediation.totalIncidents,
            });
        }
    }

    // By the Book vs High Roller
    const approvalRatio = userMemberStats.approvalTotal > 0
        ? userMemberStats.approvalThroughProcess / userMemberStats.approvalTotal
        : 0;

    if (approvalRatio >= 0.8 && userMemberStats.approvalTotal >= 20) {
        achievements.push({
            name: "📋 By the Book",
            description: `${Math.round(approvalRatio * 100)}% of changes through approvals`,
            earned: true,
            value: `${Math.round(approvalRatio * 100)}%`,
        });
    } else if (approvalRatio <= 0.2 && userMemberStats.approvalTotal >= 20) {
        achievements.push({
            name: "🎲 High Roller",
            description: `${Math.round((1 - approvalRatio) * 100)}% of changes bypassed approvals`,
            earned: true,
            value: `${Math.round((1 - approvalRatio) * 100)}%`,
        });
    }

    // Steady Hand - Low rollback rate
    if (userStats.flagsCreated >= 50 && userStats.oops) {
        const rollbackRate = userStats.oops.totalRollbacks / userStats.flagsCreated;
        if (rollbackRate < 0.05) {
            achievements.push({
                name: "🛡️ Steady Hand",
                description: `Only ${userStats.oops.totalRollbacks} rollbacks out of ${userStats.flagsCreated} flags (<5%)`,
                earned: true,
                value: `${Math.round(rollbackRate * 100)}%`,
            });
        }
    }

    return achievements;
}

function calculateRankings(
    allEntries: AuditLogEntry[],
    userId: string,
    userFlagsCreated: number,
    memberCache: Map<string, MemberDetails>,
): Ranking {
    // Count flags created per member
    const memberFlagCounts = new Map<string, number>();

    for (const entry of allEntries) {
        if (entry.kind === "flag" && entry.member) {
            const actions = entry.accesses.map((a) => a.action);
            if (actions.some((a) => a.includes("createFlag"))) {
                const memberId = entry.member._id;
                memberFlagCounts.set(
                    memberId,
                    (memberFlagCounts.get(memberId) || 0) + 1,
                );
            }
        }
    }

    // Sort members by flag count
    const sortedMembers = Array.from(memberFlagCounts.entries())
        .sort((a, b) => b[1] - a[1]);

    // Find user's rank
    const userRank = sortedMembers.findIndex(([id]) => id === userId) + 1;
    const totalMembers = sortedMembers.length;

    // Calculate percentile (higher is better)
    const percentile = totalMembers > 1
        ? Math.round(((totalMembers - userRank) / (totalMembers - 1)) * 100)
        : 100;

    // Find members above and below
    let above, below;
    if (userRank > 1) {
        const [aboveMemberId, aboveCount] = sortedMembers[userRank - 2];
        const aboveMember = memberCache.get(aboveMemberId);
        if (aboveMember) {
            above = {
                memberId: aboveMemberId,
                name: `${aboveMember.firstName} ${aboveMember.lastName}`,
                count: aboveCount,
            };
        }
    }

    if (userRank < totalMembers) {
        const [belowMemberId, belowCount] = sortedMembers[userRank];
        const belowMember = memberCache.get(belowMemberId);
        if (belowMember) {
            below = {
                memberId: belowMemberId,
                name: `${belowMember.firstName} ${belowMember.lastName}`,
                count: belowCount,
            };
        }
    }

    // Get top 5 creators
    const topCreators = sortedMembers.slice(0, 5).map(([memberId, count]) => {
        const member = memberCache.get(memberId);
        return {
            memberId,
            name: member
                ? `${member.firstName} ${member.lastName}`
                : "Unknown",
            count,
        };
    });

    return {
        rank: userRank,
        total: totalMembers,
        percentile,
        above,
        below,
        topCreators,
    };
}

// ============================================================================
// Main Function
// ============================================================================

async function generateChronicleReport(
    apiKey: string,
    inputFile?: string,
    year?: number,
): Promise<ChronicleReport> {
    // Get caller identity
    console.error("Fetching caller identity...");
    const caller = await getCallerIdentity(apiKey);
    const callerDetails = await getMemberDetails(apiKey, caller._id);

    console.error(
        `Generating report for ${callerDetails.firstName} ${callerDetails.lastName} (${callerDetails.email})`,
    );

    // Determine year
    const targetYear = year || new Date().getUTCFullYear();
    console.error(`Report year: ${targetYear}`);

    // Load audit log entries
    console.error("Loading audit log entries...");
    const allEntries: AuditLogEntry[] = [];
    const userEntries: AuditLogEntry[] = [];
    const memberCache = new Map<string, MemberDetails>();

    // Cache the caller's details
    memberCache.set(callerDetails._id, callerDetails);

    const entrySource = inputFile
        ? readAuditLogFromFile(inputFile)
        : fetchAuditLogFromAPI(apiKey, targetYear);

    for await (const entry of entrySource) {
        allEntries.push(entry);

        // Filter user's entries
        if (entry.member?._id === caller._id) {
            userEntries.push(entry);
        }

        // Cache member details from entries
        if (entry.member && !memberCache.has(entry.member._id)) {
            memberCache.set(entry.member._id, {
                _id: entry.member._id,
                email: entry.member.email,
                firstName: entry.member.firstName,
                lastName: entry.member.lastName,
            });
        }
    }

    console.error(
        `Loaded ${allEntries.length} total entries, ${userEntries.length} by user`,
    );

    // Calculate statistics
    console.error("Calculating statistics...");
    const stats = calculateUserStats(userEntries);

    // Find collaborators
    console.error("Finding collaborators...");
    const collaborators = findCollaborators(
        userEntries,
        allEntries,
        caller._id,
        memberCache,
    );

    // Calculate rankings
    console.error("Calculating rankings...");
    const rankings = calculateRankings(
        allEntries,
        caller._id,
        stats.flagsCreated,
        memberCache,
    );

    // Calculate achievements
    console.error("Calculating achievements...");
    const achievements = calculateAchievements(
        caller._id,
        stats,
        allEntries,
        collaborators,
    );

    // Build report
    const report: ChronicleReport = {
        user: {
            memberId: callerDetails._id,
            email: callerDetails.email,
            firstName: callerDetails.firstName,
            lastName: callerDetails.lastName,
        },
        year: targetYear,
        stats,
        collaborators: collaborators.slice(0, 10), // Top 10 collaborators
        rankings: {
            flagsCreated: rankings,
        },
        achievements,
    };

    return report;
}

// ============================================================================
// CLI Entry Point
// ============================================================================

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
    let year: number | undefined;

    for (let i = 0; i < Deno.args.length; i++) {
        const arg = Deno.args[i];
        if (arg === "--input") {
            inputFile = Deno.args[i + 1];
            if (!inputFile) {
                console.error("Error: --input requires a file path");
                Deno.exit(1);
            }
            i++;
        } else if (arg === "--year") {
            const yearStr = Deno.args[i + 1];
            if (!yearStr) {
                console.error("Error: --year requires a year value");
                Deno.exit(1);
            }
            year = parseInt(yearStr);
            if (isNaN(year)) {
                console.error(`Error: Invalid year value: ${yearStr}`);
                Deno.exit(1);
            }
            i++;
        } else if (arg === "--help" || arg === "-h") {
            console.log(`Chronicle - Generate a Spotify Wrapped-style report for LaunchDarkly

Usage:
  chronicle.ts [options]

Options:
  --input <file>    Read audit log from JSONL file instead of API
  --year <year>     Specify year for report (default: current year)
  --help, -h        Show this help message

Environment Variables:
  LAUNCHDARKLY_API_KEY or LD_API_KEY - Your LaunchDarkly API key (required)

Examples:
  # Generate report for current year from API
  chronicle.ts

  # Generate report from file
  chronicle.ts --input audit-log.json

  # Generate report for specific year
  chronicle.ts --year 2024
`);
            Deno.exit(0);
        }
    }

    try {
        const report = await generateChronicleReport(API_KEY, inputFile, year);
        console.log(JSON.stringify(report, null, 2));
    } catch (error) {
        console.error(`Error: ${error.message}`);
        if (error.stack) {
            console.error(error.stack);
        }
        Deno.exit(1);
    }
}
