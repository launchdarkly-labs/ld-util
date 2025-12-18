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
        max?: number;
        offset?: number;
    },
): AsyncGenerator<Record<string, unknown>> {
    const baseUrl = options?.baseUrl || "https://app.launchdarkly.com";
    let nextUrl: URL | null = new URL("/api/v2/approval-requests", baseUrl);
    let yieldedCount = 0;

    // Determine optimal limit based on max
    const limit = options?.max ? Math.min(options.max, 200) : 20;
    const initialOffset = options?.offset || 0;

    // Set up initial query parameters
    nextUrl.searchParams.set("limit", limit.toString());
    nextUrl.searchParams.set("offset", initialOffset.toString());

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
                yieldedCount++;

                // Stop if we've reached max
                if (options?.max && yieldedCount >= options.max) {
                    return;
                }
            }

            // Build next URL using offset-based pagination
            if (data.items.length > 0 && data.totalCount) {
                const currentOffset = parseInt(url.searchParams.get("offset") || "0");
                const currentLimit = parseInt(url.searchParams.get("limit") || "20");
                const newOffset = currentOffset + data.items.length;

                // Check if we need to fetch more
                const hasMore = newOffset < data.totalCount;
                const needsMore = !options?.max || yieldedCount < options.max;

                if (hasMore && needsMore) {
                    nextUrl = new URL(url);
                    nextUrl.searchParams.set("offset", newOffset.toString());

                    // Adjust limit for the next request if max is set
                    if (options?.max) {
                        const remaining = options.max - yieldedCount;
                        const nextLimit = Math.min(remaining, 200);
                        nextUrl.searchParams.set("limit", nextLimit.toString());
                    } else {
                        nextUrl.searchParams.set("limit", currentLimit.toString());
                    }
                } else {
                    nextUrl = null;
                }
            } else {
                nextUrl = null;
            }
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
        max?: number;
        offset?: number;
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
    let totalCount = countData.totalCount || 0;

    // Apply starting offset and max limit
    const startingOffset = options.offset || 0;

    // If max is provided, limit the total records to fetch
    // Otherwise, fetch all records from totalCount
    const recordsToFetch = options.max
        ? Math.min(options.max, totalCount - startingOffset)
        : totalCount - startingOffset;

    if (recordsToFetch <= 0) {
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

    // Optimize: if we can fetch all records in one or a few requests, reduce parallelChunks
    // API supports up to 200 records per request
    const maxRecordsPerRequest = 200;
    const minRequestsNeeded = Math.ceil(recordsToFetch / maxRecordsPerRequest);
    const effectiveParallelChunks = Math.min(options.parallelChunks, minRequestsNeeded);

    // Calculate offset ranges for each worker
    const chunkSize = Math.ceil(recordsToFetch / effectiveParallelChunks);
    const chunks: Array<{ startOffset: number; endOffset: number }> = [];

    for (let i = 0; i < effectiveParallelChunks; i++) {
        const chunkStartOffset = startingOffset + (i * chunkSize);
        const chunkEndOffset = Math.min(
            chunkStartOffset + chunkSize,
            startingOffset + recordsToFetch
        );
        if (chunkStartOffset >= startingOffset + recordsToFetch) break;
        chunks.push({ startOffset: chunkStartOffset, endOffset: chunkEndOffset });
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

                // Fetch multiple pages within this worker's range using limit=200
                let currentOffset = chunk.startOffset;
                const maxLimit = 200;
                const targetItemCount = chunk.endOffset - chunk.startOffset;

                while (chunkEntries < targetItemCount) {
                    const remaining = targetItemCount - chunkEntries;
                    const limit = Math.min(remaining, maxLimit);

                    const chunkUrl = new URL("/api/v2/approval-requests", baseUrl);
                    chunkUrl.searchParams.set("offset", currentOffset.toString());
                    chunkUrl.searchParams.set("limit", limit.toString());

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

                    // Move to next page within this worker's range
                    currentOffset += data.items.length;

                    // Stop if we got no items
                    if (data.items.length === 0) {
                        break;
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

function showHelp() {
    console.log(`
Get All Approval Requests

Fetches approval requests from LaunchDarkly and outputs them as NDJSON.

USAGE:
    deno run --allow-net --allow-env get-all-approval-requests.ts [OPTIONS]

ENVIRONMENT VARIABLES:
    LAUNCHDARKLY_API_KEY    LaunchDarkly API key (required)
    LD_API_KEY              Alternative API key variable
    LD_BASE_URL             Custom base URL (default: https://app.launchdarkly.com)
    LAUNCHDARKLY_BASE_URL   Alternative base URL variable

OPTIONS:
    --help                  Show this help message

FILTER OPTIONS:
    --filter-notify-member-id <id>
        Filter by member ID assigned to approval (can be specified multiple times)

    --filter-requestor-id <id>
        Filter by requester's member ID

    --filter-resource-id <id>
        Filter by resource identifier

    --filter-resource-kind <kind>
        Filter by resource type: flag, segment, or aiConfig

    --filter-review-status <status>
        Filter by review status: approved, declined, or pending
        (can be specified multiple times)

    --filter-status <status>
        Filter by approval status: pending, scheduled, failed, or completed
        (can be specified multiple times)

OTHER OPTIONS:
    --expand <field>
        Include additional details: flag, project, or environments
        (can be specified multiple times)

    --parallel <num>
        Number of parallel requests to use for faster fetching
        (default: sequential)

    --base-url <url>
        Custom base URL for LaunchDarkly API
        (default: https://app.launchdarkly.com)

    --max <number>
        Maximum number of approval requests to fetch
        (default: fetch all)

    --offset <number>
        Starting offset for pagination
        (default: 0)

EXAMPLES:
    # Get all approval requests
    deno run --allow-net --allow-env get-all-approval-requests.ts

    # Filter by review status
    deno run --allow-net --allow-env get-all-approval-requests.ts \\
      --filter-review-status approved

    # Use parallel fetching for faster downloads
    deno run --allow-net --allow-env get-all-approval-requests.ts \\
      --parallel 10

    # Combine filters and expansion
    deno run --allow-net --allow-env get-all-approval-requests.ts \\
      --filter-resource-kind flag \\
      --filter-review-status pending \\
      --expand flag --expand project

    # Calculate metrics with jq
    deno run --allow-net --allow-env get-all-approval-requests.ts | \\
      jq -s 'group_by(.reviewStatus) | map({status: .[0].reviewStatus, count: length})'

For more examples and jq recipes, see the README.md file.
`);
}

// Main execution
if (import.meta.main) {
    // Parse command line arguments first to check for --help
    const flags = parseArgs(Deno.args, {
        boolean: ["help"],
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
            "max",
            "offset",
        ],
        collect: [
            "filter-notify-member-id",
            "filter-review-status",
            "filter-status",
            "expand",
        ],
        default: {},
    });

    // Show help if requested
    if (flags.help) {
        showHelp();
        Deno.exit(0);
    }

    const API_KEY = Deno.env.get("LAUNCHDARKLY_API_KEY") || Deno.env.get("LD_API_KEY");
    if (!API_KEY) {
        console.error(
            "Error: LAUNCHDARKLY_API_KEY or LD_API_KEY environment variable is required",
        );
        console.error("Run with --help for usage information");
        Deno.exit(1);
    }

    // Get base URL from environment variable or default
    let baseUrl = Deno.env.get("LD_BASE_URL") ||
                  Deno.env.get("LAUNCHDARKLY_BASE_URL") ||
                  "https://app.launchdarkly.com";

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

    // Parse max option
    let maxRecords: number | undefined;
    if (flags.max) {
        maxRecords = parseInt(flags.max as string);
        if (isNaN(maxRecords) || maxRecords < 1) {
            console.error(`Error: --max must be a positive integer`);
            Deno.exit(1);
        }
    }

    // Parse offset option
    let startOffset: number | undefined;
    if (flags.offset) {
        startOffset = parseInt(flags.offset as string);
        if (isNaN(startOffset) || startOffset < 0) {
            console.error(`Error: --offset must be a non-negative integer`);
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
        max: maxRecords,
        offset: startOffset,
    };

    try {
        if (parallelChunks) {
            // Check if stderr is a TTY (terminal) for progress bar
            const isTTY = Deno.stderr.isTerminal();

            // Use parallel fetching with progress logging to stderr (streaming)
            for await (
                const entry of getAllApprovalRequestsParallel(API_KEY, {
                    ...options,
                    parallelChunks,
                    onProgress: (progress) => {
                        if (isTTY) {
                            // Use carriage return to update the same line
                            // Clear line with spaces to handle varying message lengths
                            const clearLine = "\r\x1b[K"; // Carriage return + clear to end of line

                            switch (progress.type) {
                                case "start":
                                    Deno.stderr.writeSync(
                                        new TextEncoder().encode(
                                            `Fetching approval requests in ${progress.totalChunks} parallel chunks...\n`
                                        )
                                    );
                                    break;
                                case "fetching":
                                    Deno.stderr.writeSync(
                                        new TextEncoder().encode(
                                            `${clearLine}[${progress.percentage}%] Retrieved ${progress.totalEntriesFetched?.toLocaleString()} entries...`
                                        )
                                    );
                                    break;
                                case "chunk_complete":
                                    Deno.stderr.writeSync(
                                        new TextEncoder().encode(
                                            `${clearLine}[${progress.percentage}%] Retrieved ${progress.totalEntriesFetched?.toLocaleString()} entries (${progress.completedChunks}/${progress.totalChunks} requests complete)`
                                        )
                                    );
                                    break;
                                case "complete":
                                    Deno.stderr.writeSync(
                                        new TextEncoder().encode(
                                            `${clearLine}[100%] Complete: ${progress.uniqueEntries?.toLocaleString()} entries retrieved\n`
                                        )
                                    );
                                    break;
                            }
                        } else {
                            // Non-TTY: only show chunk_complete and complete messages
                            switch (progress.type) {
                                case "start":
                                    console.error(
                                        `Fetching approval requests in ${progress.totalChunks} parallel chunks...`,
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
