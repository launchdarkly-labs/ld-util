#!/usr/bin/env -S deno run --allow-net --allow-env

import { parseArgs } from "jsr:@std/cli/parse-args";

interface APIResponse {
    items: Record<string, unknown>[];
    totalCount?: number;
    _links: {
        next?: { href: string };
    };
}

export interface FilterOptions {
    notifyMemberIds?: string[];
    requestorId?: string;
    resourceId?: string;
    resourceKind?: "flag" | "segment" | "aiConfig";
    reviewStatus?: Array<"approved" | "declined" | "pending">;
    status?: Array<"pending" | "scheduled" | "failed" | "completed">;
}

export async function* getAllApprovalRequests(
    apiKey: string,
    options?: {
        filter?: FilterOptions;
        expand?: Array<"flag" | "project" | "environments">;
        baseUrl?: string;
    },
): AsyncGenerator<Record<string, unknown>> {
    const baseUrl = options?.baseUrl || "https://app.launchdarkly.com";
    let nextUrl: URL | null = new URL("/api/v2/approval-requests", baseUrl);

    // Set up initial query parameters
    nextUrl.searchParams.set("limit", "20");

    // Build filter parameter
    if (options?.filter) {
        const filters: string[] = [];
        const f = options.filter;

        if (f.notifyMemberIds && f.notifyMemberIds.length > 0) {
            filters.push(`notifyMemberIds anyOf [${f.notifyMemberIds.join(",")}]`);
        }
        if (f.requestorId) {
            filters.push(`requestorId equals ${f.requestorId}`);
        }
        if (f.resourceId) {
            filters.push(`resourceId equals ${f.resourceId}`);
        }
        if (f.resourceKind) {
            filters.push(`resourceKind equals ${f.resourceKind}`);
        }
        if (f.reviewStatus && f.reviewStatus.length > 0) {
            filters.push(`reviewStatus anyOf [${f.reviewStatus.join(",")}]`);
        }
        if (f.status && f.status.length > 0) {
            filters.push(`status anyOf [${f.status.join(",")}]`);
        }

        if (filters.length > 0) {
            nextUrl.searchParams.set("filter", filters.join(","));
        }
    }

    // Build expand parameter
    if (options?.expand && options.expand.length > 0) {
        nextUrl.searchParams.set("expand", options.expand.join(","));
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
                // Handle rate limiting
                const resetTime = response.headers.get("X-RateLimit-Reset");
                if (resetTime) {
                    const waitMs = Math.min(
                        (parseInt(resetTime) * 1000) - Date.now(),
                        1000,
                    );

                    await new Promise((resolve) => setTimeout(resolve, waitMs));
                    continue; // Retry the same URL
                }
            }

            if (!response.ok) {
                if (response.status >= 500 || response.status === 429) {
                    // Retry after a short delay for server errors and rate limits
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    continue;
                }
                throw new Error(
                    `API request failed: ${response.status} ${response.statusText}`,
                );
            }

            const data: APIResponse = await response.json();

            // Yield each approval request
            for (const entry of data.items) {
                yield entry;
            }

            // Get next page URL if it exists
            nextUrl = data._links?.next?.href ? new URL(data._links.next.href, baseUrl) : null;
        } catch (error) {
            if (error instanceof TypeError && error.message.includes("fetch")) {
                // Network error, retry after a delay
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }
            throw error;
        }
    }
}

export interface ProgressInfo {
    type: "start" | "chunk_start" | "fetching" | "chunk_complete" | "complete";
    totalChunks: number;
    completedChunks: number;
    percentage: number;
    chunkIndex?: number;
    entriesCount?: number;           // Entries in current chunk
    totalEntriesFetched?: number;    // Total unique entries yielded so far (all chunks, deduplicated)
    uniqueEntries?: number;           // Final count of unique entries (only in "complete")
    duplicatesRemoved?: number;       // Total duplicates removed (only in "complete")
}

export interface ProgressCallback {
    (progress: ProgressInfo): void;
}

/**
 * Fetch approval requests in parallel by splitting into offset-based chunks
 * Uses Set-based deduplication to avoid duplicate entries
 */
export async function* getAllApprovalRequestsParallel(
    apiKey: string,
    options: {
        filter?: FilterOptions;
        expand?: Array<"flag" | "project" | "environments">;
        parallelChunks: number;
        onProgress?: ProgressCallback;
        baseUrl?: string;
    },
): AsyncGenerator<Record<string, unknown>> {
    const baseUrl = options.baseUrl || "https://app.launchdarkly.com";

    // First, fetch the total count
    const countUrl = new URL("/api/v2/approval-requests", baseUrl);
    countUrl.searchParams.set("limit", "1");

    // Build filter parameter
    if (options?.filter) {
        const filters: string[] = [];
        const f = options.filter;

        if (f.notifyMemberIds && f.notifyMemberIds.length > 0) {
            filters.push(`notifyMemberIds anyOf [${f.notifyMemberIds.join(",")}]`);
        }
        if (f.requestorId) {
            filters.push(`requestorId equals ${f.requestorId}`);
        }
        if (f.resourceId) {
            filters.push(`resourceId equals ${f.resourceId}`);
        }
        if (f.resourceKind) {
            filters.push(`resourceKind equals ${f.resourceKind}`);
        }
        if (f.reviewStatus && f.reviewStatus.length > 0) {
            filters.push(`reviewStatus anyOf [${f.reviewStatus.join(",")}]`);
        }
        if (f.status && f.status.length > 0) {
            filters.push(`status anyOf [${f.status.join(",")}]`);
        }

        if (filters.length > 0) {
            countUrl.searchParams.set("filter", filters.join(","));
        }
    }

    const countResponse = await fetch(countUrl, {
        headers: {
            "Authorization": apiKey,
            "Content-Type": "application/json",
        },
    });

    if (!countResponse.ok) {
        throw new Error(
            `Failed to fetch total count: ${countResponse.status} ${countResponse.statusText}`,
        );
    }

    const countData: APIResponse = await countResponse.json();
    const totalCount = countData.totalCount || 0;

    if (totalCount === 0) {
        options.onProgress?.({
            type: "complete",
            totalChunks: 0,
            completedChunks: 0,
            percentage: 100,
            uniqueEntries: 0,
            duplicatesRemoved: 0,
        });
        return;
    }

    // Calculate chunk size and create offset chunks
    const chunkSize = Math.ceil(totalCount / options.parallelChunks);
    const chunks: Array<{ offset: number; limit: number }> = [];

    for (let i = 0; i < options.parallelChunks; i++) {
        const offset = i * chunkSize;
        if (offset >= totalCount) break;
        const limit = Math.min(chunkSize, totalCount - offset);
        chunks.push({ offset, limit });
    }

    // Report start
    options.onProgress?.({
        type: "start",
        totalChunks: chunks.length,
        completedChunks: 0,
        percentage: 0,
    });

    // Track seen entry IDs to avoid duplicates
    const seenIds = new Set<string>();
    let completedChunks = 0;
    let totalEntriesFetched = 0;
    let totalDuplicates = 0;

    // Queue for entries as they're fetched
    const queue: Array<Record<string, unknown>> = [];
    let activeChunks = chunks.length;
    let hasError: Error | null = null;

    // Start all chunk fetchers in parallel
    chunks.forEach((chunk, index) => {
        (async () => {
            let chunkEntries = 0;
            let lastReportedCount = 0;
            const reportInterval = 50; // Report every 50 entries

            try {
                options.onProgress?.({
                    type: "chunk_start",
                    totalChunks: chunks.length,
                    completedChunks,
                    percentage: 0,
                    chunkIndex: index,
                    totalEntriesFetched,
                });

                // Fetch this specific chunk using offset/limit
                const chunkUrl = new URL("/api/v2/approval-requests", baseUrl);
                chunkUrl.searchParams.set("offset", chunk.offset.toString());
                chunkUrl.searchParams.set("limit", chunk.limit.toString());

                // Apply filters and expand
                if (options?.filter) {
                    const filters: string[] = [];
                    const f = options.filter;

                    if (f.notifyMemberIds && f.notifyMemberIds.length > 0) {
                        filters.push(`notifyMemberIds anyOf [${f.notifyMemberIds.join(",")}]`);
                    }
                    if (f.requestorId) {
                        filters.push(`requestorId equals ${f.requestorId}`);
                    }
                    if (f.resourceId) {
                        filters.push(`resourceId equals ${f.resourceId}`);
                    }
                    if (f.resourceKind) {
                        filters.push(`resourceKind equals ${f.resourceKind}`);
                    }
                    if (f.reviewStatus && f.reviewStatus.length > 0) {
                        filters.push(`reviewStatus anyOf [${f.reviewStatus.join(",")}]`);
                    }
                    if (f.status && f.status.length > 0) {
                        filters.push(`status anyOf [${f.status.join(",")}]`);
                    }

                    if (filters.length > 0) {
                        chunkUrl.searchParams.set("filter", filters.join(","));
                    }
                }

                if (options?.expand && options.expand.length > 0) {
                    chunkUrl.searchParams.set("expand", options.expand.join(","));
                }

                const response = await fetch(chunkUrl, {
                    headers: {
                        "Authorization": apiKey,
                        "Content-Type": "application/json",
                    },
                });

                if (!response.ok) {
                    throw new Error(
                        `API request failed: ${response.status} ${response.statusText}`,
                    );
                }

                const data: APIResponse = await response.json();

                for (const entry of data.items) {
                    queue.push(entry);
                    chunkEntries++;

                    // Report progress every N entries
                    if (chunkEntries - lastReportedCount >= reportInterval) {
                        lastReportedCount = chunkEntries;
                        const percentage = Math.round((completedChunks / chunks.length) * 100);
                        options.onProgress?.({
                            type: "fetching",
                            totalChunks: chunks.length,
                            completedChunks,
                            percentage,
                            chunkIndex: index,
                            entriesCount: chunkEntries,
                            totalEntriesFetched,
                        });
                    }
                }

                completedChunks++;
                const percentage = Math.round((completedChunks / chunks.length) * 100);
                options.onProgress?.({
                    type: "chunk_complete",
                    totalChunks: chunks.length,
                    completedChunks,
                    percentage,
                    chunkIndex: index,
                    entriesCount: chunkEntries,
                    totalEntriesFetched,
                });
            } catch (err) {
                hasError = err as Error;
            } finally {
                activeChunks--;
            }
        })();
    });

    // Yield from queue as entries arrive, deduplicating in real-time
    while (activeChunks > 0 || queue.length > 0) {
        if (hasError) throw hasError;

        while (queue.length > 0) {
            const entry = queue.shift()!;
            const id = entry._id as string;

            if (!seenIds.has(id)) {
                seenIds.add(id);
                totalEntriesFetched++;
                yield entry;
            } else {
                totalDuplicates++;
            }
        }

        // Small delay if queue is empty but chunks are still active
        if (activeChunks > 0 && queue.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    // Report completion
    options.onProgress?.({
        type: "complete",
        totalChunks: chunks.length,
        completedChunks: chunks.length,
        percentage: 100,
        uniqueEntries: seenIds.size,
        duplicatesRemoved: totalDuplicates,
    });
}

// Main execution
if (import.meta.main) {
    const API_KEY = Deno.env.get("LAUNCHDARKLY_API_KEY") || Deno.env.get("LD_API_KEY");
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
    const flags = parseArgs(Deno.args, {
        string: [
            "filter-notify-member-id",
            "filter-requestor-id",
            "filter-resource-id",
            "filter-resource-kind",
            "filter-review-status",
            "filter-status",
            "expand",
            "parallel",
            "base-url",
        ],
        collect: [
            "filter-notify-member-id",
            "filter-review-status",
            "filter-status",
            "expand",
        ],
        default: {},
    });

    // Build filter options
    const filter: FilterOptions = {};

    if (flags["filter-notify-member-id"]) {
        const ids = Array.isArray(flags["filter-notify-member-id"])
            ? flags["filter-notify-member-id"]
            : [flags["filter-notify-member-id"]];
        filter.notifyMemberIds = ids;
    }

    if (flags["filter-requestor-id"]) {
        filter.requestorId = flags["filter-requestor-id"] as string;
    }

    if (flags["filter-resource-id"]) {
        filter.resourceId = flags["filter-resource-id"] as string;
    }

    if (flags["filter-resource-kind"]) {
        const kind = flags["filter-resource-kind"] as string;
        if (!["flag", "segment", "aiConfig"].includes(kind)) {
            console.error(`Error: --filter-resource-kind must be one of: flag, segment, aiConfig`);
            Deno.exit(1);
        }
        filter.resourceKind = kind as "flag" | "segment" | "aiConfig";
    }

    if (flags["filter-review-status"]) {
        const statuses = Array.isArray(flags["filter-review-status"])
            ? flags["filter-review-status"]
            : [flags["filter-review-status"]];
        filter.reviewStatus = statuses as Array<"approved" | "declined" | "pending">;
    }

    if (flags["filter-status"]) {
        const statuses = Array.isArray(flags["filter-status"])
            ? flags["filter-status"]
            : [flags["filter-status"]];
        filter.status = statuses as Array<"pending" | "scheduled" | "failed" | "completed">;
    }

    // Build expand options
    const expand: Array<"flag" | "project" | "environments"> = [];
    if (flags.expand) {
        const expandValues = Array.isArray(flags.expand)
            ? flags.expand
            : [flags.expand];
        expand.push(...expandValues as Array<"flag" | "project" | "environments">);
    }

    // Parse parallel option
    let parallelChunks: number | undefined;
    if (flags.parallel) {
        parallelChunks = parseInt(flags.parallel as string);
        if (isNaN(parallelChunks) || parallelChunks < 1) {
            console.error(`Error: --parallel must be a positive integer`);
            Deno.exit(1);
        }
    }

    // Parse base URL
    if (flags["base-url"]) {
        baseUrl = flags["base-url"] as string;
        // Ensure it has https:// prefix
        if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
            baseUrl = "https://" + baseUrl;
        }
    }

    const options = {
        filter: Object.keys(filter).length > 0 ? filter : undefined,
        expand: expand.length > 0 ? expand : undefined,
        baseUrl,
    };

    try {
        if (parallelChunks) {
            // Use parallel fetching with progress logging to stderr (streaming)
            for await (
                const entry of getAllApprovalRequestsParallel(API_KEY, {
                    ...options,
                    parallelChunks,
                    onProgress: (progress) => {
                        switch (progress.type) {
                            case "start":
                                console.error(
                                    `Fetching approval requests in ${progress.totalChunks} parallel chunks...`,
                                );
                                break;
                            case "fetching":
                                console.error(
                                    `[${progress.percentage}%] Retrieved ${progress.totalEntriesFetched?.toLocaleString()} entries...`,
                                );
                                break;
                            case "chunk_complete":
                                console.error(
                                    `[${progress.percentage}%] Retrieved ${progress.totalEntriesFetched?.toLocaleString()} entries (${progress.completedChunks}/${progress.totalChunks} requests complete)`,
                                );
                                break;
                            case "complete":
                                console.error(
                                    `[100%] Complete: ${progress.uniqueEntries?.toLocaleString()} entries retrieved`,
                                );
                                break;
                        }
                    },
                })
            ) {
                console.log(JSON.stringify(entry, null, 0));
            }
        } else {
            // Use sequential fetching (default, streaming)
            for await (const entry of getAllApprovalRequests(API_KEY, options)) {
                console.log(JSON.stringify(entry, null, 0));
            }
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        Deno.exit(1);
    }
}
