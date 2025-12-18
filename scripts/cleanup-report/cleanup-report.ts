#!/usr/bin/env -S deno run --allow-net --allow-env

interface Flag {
    key: string;
    name?: string;
    tags?: string[];
    temporary?: boolean;
    creationDate?: number;
    clientSideAvailability?: {
        usingMobileKey?: boolean;
        usingEnvironmentId?: boolean;
    };
    _maintainer?: {
        _id?: string;
        _links?: Record<string, unknown>;
        email?: string;
        firstName?: string;
        lastName?: string;
        role?: string;
    };
    _maintainerTeam?: {
        key?: string;
        name?: string;
    };
    stale?: boolean | {
        cleanupId?: string | null;
        readyForCodeRemoval?: boolean;
        readyToArchive?: boolean;
    };
    customProperties?: Record<string, unknown>;
    description?: string;
    codeReferences?: {
        _links?: {
            self?: {
                href?: string;
                type?: string;
            };
        };
        items?: Array<{
            _links?: {
                self?: {
                    href?: string;
                    type?: string;
                };
            };
            defaultBranch?: string;
            enabled?: boolean;
            fileCount?: number;
            hunkCount?: number;
            latestCommitTime?: number;
            name?: string;
            sourceLink?: string;
            type?: string;
            version?: number;
        }>;
    };
    environments: Record<string, {
        on: boolean;
        lastModified?: number;
        fallthrough?: number | null | {
            variation?: number;
            variations?: Array<{
                variation: number;
                weight: number;
            }>;
        };
        offVariation?: number | null;
        rules?: Array<{
            variation?: number;
            rollout?: {
                variations: Array<{
                    variation: number;
                    weight: number;
                }>;
            };
        }>;
        targets?: Array<{
            variation: number;
            values?: string[];
        }>;
        contextTargets?: Array<{
            variation: number;
            values?: string[];
            contextKind?: string;
        }>;
        _summary?: {
            prerequisites?: number;
            variations?: Record<string, {
                isFallthrough?: boolean;
                isOff?: boolean;
                rules?: number;
                targets?: number;
                contextTargets?: number;
            }>;
        };
    }>;
    variations: Array<{
        value: unknown;
        name?: string;
        description?: string;
    }>;
}

interface FlagStatus {
    default?: unknown;
    name?: string;
    lastRequested?: number;
    _links: {
        parent: {
            href: string;
        };
    };
}

interface APIResponse {
    items: Record<string, unknown>[];
    _links: {
        next?: { href: string };
    };
}

interface CleanupReportOutput {
    key: string;
    name?: string;
    tags?: string[];
    temporary?: boolean;
    creationDate?: number;
    clientSideAvailability?: {
        usingMobileKey?: boolean;
        usingEnvironmentId?: boolean;
    };
    _maintainer?: {
        _id?: string;
        _links?: Record<string, unknown>;
        email?: string;
        firstName?: string;
        lastName?: string;
        role?: string;
    };
    _maintainerTeam?: {
        key?: string;
        name?: string;
    };
    stale?: boolean | {
        cleanupId?: string | null;
        readyForCodeRemoval?: boolean;
        readyToArchive?: boolean;
    };
    customProperties?: Record<string, unknown>;
    description?: string;
    codeReferences?: {
        _links?: {
            self?: {
                href?: string;
                type?: string;
            };
        };
        items?: Array<{
            _links?: {
                self?: {
                    href?: string;
                    type?: string;
                };
            };
            defaultBranch?: string;
            enabled?: boolean;
            fileCount?: number;
            hunkCount?: number;
            latestCommitTime?: number;
            name?: string;
            sourceLink?: string;
            type?: string;
            version?: number;
        }>;
    };
    environment: string;
    lastModified?: number;
    lastRequested?: number;
    status?: string;
    variations_served: number[];
    fallback_value?: unknown;
    variations: Array<{
        value: unknown;
        name?: string;
        description?: string;
    }>;
    _summary?: {
        prerequisites?: number;
        variations?: Record<string, {
            isFallthrough?: boolean;
            isOff?: boolean;
            rules?: number;
            targets?: number;
            contextTargets?: number;
        }>;
    };
}

async function* getAllFlags(
    projectKey: string,
    apiKey: string,
    baseUrl: string,
    parameters?: URLSearchParams,
): AsyncGenerator<Record<string, unknown>> {
    let nextUrl: URL | null = new URL(`/api/v2/flags/${projectKey}`, baseUrl);
    if (parameters) {
        parameters.forEach((value, key) => {
            nextUrl!.searchParams.set(key, value);
        });
    }

    while (nextUrl) {
        const url = new URL(nextUrl, baseUrl);
        try {
            const response = await fetch(url, {
                headers: {
                    "Authorization": apiKey,
                    "Content-Type": "application/json",
                },
            });

            if (response.status === 429) {
                const resetTime = response.headers.get("X-RateLimit-Reset");
                if (resetTime) {
                    const waitMs = Math.min(
                        (parseInt(resetTime) * 1000) - Date.now(),
                        1000,
                    );
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                    continue;
                }
            }

            if (!response.ok) {
                if (response.status >= 500 || response.status === 429) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                const errorBody = await response.text().catch(() => "");
                throw new Error(
                    `API request failed: ${response.status} ${response.statusText}\nURL: ${url}\nResponse: ${errorBody}`,
                );
            }

            const data: APIResponse = await response.json();

            for (const flag of data.items) {
                yield flag;
            }

            nextUrl = data._links?.next?.href ? new URL(data._links.next.href, baseUrl) : null;
        } catch (error) {
            if (error instanceof TypeError && error.message.includes("fetch")) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }
            throw error;
        }
    }
}

async function* getAllFlagStatuses(
    projectKey: string,
    environmentKey: string,
    apiKey: string,
    baseUrl: string,
): AsyncGenerator<Record<string, unknown>> {
    let nextUrl = `/api/v2/flag-statuses/${projectKey}/${environmentKey}`;

    while (nextUrl) {
        const url = new URL(nextUrl, baseUrl);
        try {
            const response = await fetch(url, {
                headers: {
                    "Authorization": apiKey,
                    "Content-Type": "application/json",
                },
            });

            if (response.status === 429) {
                const resetTime = response.headers.get("X-RateLimit-Reset");
                if (resetTime) {
                    const waitMs = Math.min(
                        (parseInt(resetTime) * 1000) - Date.now(),
                        1000,
                    );
                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                    continue;
                }
            }

            if (!response.ok) {
                if (response.status >= 500 || response.status === 429) {
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                const errorBody = await response.text().catch(() => "");
                throw new Error(
                    `API request failed: ${response.status} ${response.statusText}\nURL: ${url}\nResponse: ${errorBody}`,
                );
            }

            const data: APIResponse = await response.json();

            for (const flagStatus of data.items) {
                yield flagStatus;
            }

            nextUrl = data._links?.next?.href || "";
        } catch (error) {
            if (error instanceof TypeError && error.message.includes("fetch")) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }
            throw error;
        }
    }
}

function extractFlagKeyFromHref(href: string): string | null {
    const match = href.match(/\/api\/v2\/flags\/[^/]+\/(.+)$/);
    return match ? match[1] : null;
}

function isRollout(fallthrough: number | { variation?: number; variations?: Array<{ variation: number; weight: number }> } | null | undefined): boolean {
    return typeof fallthrough === "object" && fallthrough !== null &&
        Array.isArray(fallthrough.variations);
}

function getFallthroughVariation(fallthrough: number | { variation?: number; variations?: Array<{ variation: number; weight: number }> } | null | undefined): number | null {
    if (fallthrough === null || fallthrough === undefined) {
        return null;
    }
    if (typeof fallthrough === "number") {
        return fallthrough;
    }
    if (fallthrough.variation !== undefined) {
        return fallthrough.variation;
    }
    return null;
}

function getAllVariationsServed(
    flag: Flag,
    environmentKey: string,
): Set<number> {
    const servedVariations = new Set<number>();
    const env = flag.environments[environmentKey];
    if (!env) return servedVariations;

    // Get variations from fallthrough
    const fallthrough = env.fallthrough;
    if (fallthrough !== null && fallthrough !== undefined) {
        if (isRollout(fallthrough)) {
            const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
            for (const v of rollout.variations) {
                servedVariations.add(v.variation);
            }
        } else {
            const fallthroughVariation = getFallthroughVariation(fallthrough);
            if (fallthroughVariation !== null) {
                servedVariations.add(fallthroughVariation);
            }
        }
    } else if (env._summary?.variations) {
        // Fallthrough is null/undefined, check _summary for fallthrough variation
        for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
            if (varInfo.isFallthrough) {
                servedVariations.add(parseInt(varIndex));
                break;
            }
        }
    }

    // Get variations from rules
    if (Array.isArray(env.rules)) {
        for (const rule of env.rules) {
            if (rule.variation !== undefined && rule.variation !== null) {
                servedVariations.add(rule.variation);
            } else if (rule.rollout?.variations) {
                for (const v of rule.rollout.variations) {
                    servedVariations.add(v.variation);
                }
            }
        }
    }

    // Get variations from targets
    if (Array.isArray(env.targets)) {
        for (const target of env.targets) {
            if (target.variation !== undefined && target.variation !== null) {
                servedVariations.add(target.variation);
            }
        }
    }

    // Get variations from context targets
    if (Array.isArray(env.contextTargets)) {
        for (const target of env.contextTargets) {
            if (target.variation !== undefined && target.variation !== null) {
                servedVariations.add(target.variation);
            }
        }
    }

    return servedVariations;
}

async function generateCleanupReport(
    projectKey: string,
    environmentKey: string,
    apiKey: string,
    baseUri: string,
): Promise<void> {
    const flagsMap = new Map<string, Flag>();
    const statusesMap = new Map<string, FlagStatus>();

    // Set up query parameters for flags API
    const parameters = new URLSearchParams();
    parameters.append("expand", "evaluation,codeReferences,archiveChecks");
    parameters.append("summary", "0");
    parameters.append("env", environmentKey);
    parameters.append("filter", `filterEnv:${environmentKey},state:live`);

    // Fetch all flags with the specified parameters
    for await (const flag of getAllFlags(projectKey, apiKey, baseUri, parameters)) {
        const flagData = flag as unknown as Flag;
        flagsMap.set(flagData.key, flagData);
    }

    // Fetch all flag statuses
    for await (const status of getAllFlagStatuses(projectKey, environmentKey, apiKey, baseUri)) {
        const statusData = status as unknown as FlagStatus;
        const flagKey = extractFlagKeyFromHref(statusData._links.parent.href);
        if (flagKey) {
            statusesMap.set(flagKey, statusData);
        }
    }

    // Generate output for each flag
    for (const [flagKey, flag] of flagsMap) {
        const status = statusesMap.get(flagKey);
        const env = flag.environments[environmentKey];

        // Get all variations served in this environment
        const variationsServedSet = getAllVariationsServed(flag, environmentKey);
        const variationsServed = Array.from(variationsServedSet).sort((a, b) => a - b);

        const output: CleanupReportOutput = {
            key: flag.key,
            name: flag.name,
            tags: flag.tags,
            temporary: flag.temporary,
            creationDate: flag.creationDate,
            clientSideAvailability: flag.clientSideAvailability,
            _maintainer: flag._maintainer,
            _maintainerTeam: flag._maintainerTeam,
            stale: flag.stale,
            customProperties: flag.customProperties,
            description: flag.description,
            codeReferences: flag.codeReferences,
            environment: environmentKey,
            lastModified: env?.lastModified,
            lastRequested: status?.lastRequested,
            status: status?.name,
            variations_served: variationsServed,
            fallback_value: status?.default,
            variations: flag.variations,
            _summary: env?._summary,
        };

        // Output as JSONL (one JSON object per line)
        console.log(JSON.stringify(output));
    }
}

// Main execution
if (import.meta.main) {
    const API_KEY = Deno.env.get("LAUNCHDARKLY_API_KEY") || Deno.env.get("LD_API_KEY");
    if (!API_KEY) {
        console.error("Error: LAUNCHDARKLY_API_KEY or LD_API_KEY environment variable is required");
        Deno.exit(1);
    }

    const projectKey = Deno.args[0];
    if (!projectKey) {
        console.error("Error: Project key argument is required");
        console.error("Usage: cleanup-report.ts <project-key> <environment-key> [base-uri]");
        Deno.exit(1);
    }

    const environmentKey = Deno.args[1];
    if (!environmentKey) {
        console.error("Error: Environment key argument is required");
        console.error("Usage: cleanup-report.ts <project-key> <environment-key> [base-uri]");
        Deno.exit(1);
    }

    // Get base URI from command line argument, environment variable, or use default
    const baseUri = Deno.args[2] ||
                    Deno.env.get("LAUNCHDARKLY_BASE_URI") ||
                    "https://app.launchdarkly.com/";

    generateCleanupReport(projectKey, environmentKey, API_KEY, baseUri)
        .then(() => {
            Deno.exit(0);
        })
        .catch((error) => {
            console.error(`Error generating cleanup report: ${error.message}`);
            Deno.exit(1);
        });
}
