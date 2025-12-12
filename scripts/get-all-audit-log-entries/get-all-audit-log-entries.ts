#!/usr/bin/env -S deno run --allow-net --allow-env

interface APIResponse {
    items: Record<string, unknown>[];
    _links: {
        next?: { href: string };
    };
}

/**
 * Convert ISO 8601 string or unix timestamp to milliseconds
 */
function toMilliseconds(value: string | number): number {
    if (typeof value === "number") {
        return value;
    }

    // Try to parse as numeric timestamp first
    const numValue = Number(value);
    if (!isNaN(numValue)) {
        return numValue;
    }

    // Try to parse as ISO 8601 string
    const date = new Date(value);
    if (isNaN(date.getTime())) {
        throw new Error(`Invalid date format: ${value}`);
    }
    return date.getTime();
}

export async function* getAllAuditLogEntries(
    apiKey: string,
    options?: {
        before?: string | number;
        after?: string | number;
        query?: string;
        spec?: string;
    },
): AsyncGenerator<Record<string, unknown>> {
    const baseUrl = "https://app.launchdarkly.com/";
    let nextUrl: URL | null = new URL("/api/v2/auditlog", baseUrl);

    // Set up initial query parameters
    nextUrl.searchParams.set("limit", "20");

    if (options?.before !== undefined) {
        nextUrl.searchParams.set("before", toMilliseconds(options.before).toString());
    }

    if (options?.after !== undefined) {
        nextUrl.searchParams.set("after", toMilliseconds(options.after).toString());
    }

    if (options?.query) {
        nextUrl.searchParams.set("q", options.query);
    }

    if (options?.spec) {
        nextUrl.searchParams.set("spec", options.spec);
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

            // Yield each audit log entry
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
    timeRange?: { after: string; before: string };
    entriesCount?: number;           // Entries in current chunk
    totalEntriesFetched?: number;    // Total unique entries yielded so far (all chunks, deduplicated)
    uniqueEntries?: number;           // Final count of unique entries (only in "complete")
    duplicatesRemoved?: number;       // Total duplicates removed (only in "complete")
}

export interface ProgressCallback {
    (progress: ProgressInfo): void;
}

/**
 * Fetch audit log entries in parallel by splitting the time range into chunks
 * Uses Set-based deduplication to avoid duplicate entries
 */
export async function* getAllAuditLogEntriesParallel(
    apiKey: string,
    options: {
        before?: string | number;
        after?: string | number;
        query?: string;
        spec?: string;
        parallelChunks: number;
        onProgress?: ProgressCallback;
    },
): AsyncGenerator<Record<string, unknown>> {
    // Calculate time range
    const before = options.before !== undefined ? toMilliseconds(options.before) : Date.now();
    const after = options.after !== undefined
        ? toMilliseconds(options.after)
        : Date.now() - (30 * 24 * 60 * 60 * 1000);

    const totalRange = before - after;
    const chunkSize = Math.ceil(totalRange / options.parallelChunks);

    // Create time chunks
    const chunks: Array<{ after: number; before: number }> = [];
    for (let i = 0; i < options.parallelChunks; i++) {
        const chunkAfter = after + (i * chunkSize);
        const chunkBefore = Math.min(after + ((i + 1) * chunkSize), before);
        chunks.push({ after: chunkAfter, before: chunkBefore });
    }

    // Report start
    options.onProgress?.({
        type: "start",
        totalChunks: options.parallelChunks,
        completedChunks: 0,
        percentage: 0,
        timeRange: {
            after: new Date(after).toISOString(),
            before: new Date(before).toISOString(),
        },
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
                    totalChunks: options.parallelChunks,
                    completedChunks,
                    percentage: 0,
                    chunkIndex: index,
                    timeRange: {
                        after: new Date(chunk.after).toISOString(),
                        before: new Date(chunk.before).toISOString(),
                    },
                    totalEntriesFetched,
                });

                for await (
                    const entry of getAllAuditLogEntries(apiKey, {
                        query: options.query,
                        spec: options.spec,
                        after: chunk.after,
                        before: chunk.before,
                    })
                ) {
                    queue.push(entry);
                    chunkEntries++;

                    // Report progress every N entries
                    if (chunkEntries - lastReportedCount >= reportInterval) {
                        lastReportedCount = chunkEntries;
                        const percentage = Math.round((completedChunks / options.parallelChunks) * 100);
                        options.onProgress?.({
                            type: "fetching",
                            totalChunks: options.parallelChunks,
                            completedChunks,
                            percentage,
                            chunkIndex: index,
                            entriesCount: chunkEntries,
                            totalEntriesFetched,
                        });
                    }
                }

                completedChunks++;
                const percentage = Math.round((completedChunks / options.parallelChunks) * 100);
                options.onProgress?.({
                    type: "chunk_complete",
                    totalChunks: options.parallelChunks,
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
        totalChunks: options.parallelChunks,
        completedChunks: options.parallelChunks,
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

    // Parse command line arguments
    const options: {
        before?: string | number;
        after?: string | number;
        query?: string;
        spec?: string;
    } = {};
    let parallelChunks: number | undefined;
    let sorted = false;

    for (let i = 0; i < Deno.args.length; i++) {
        const arg = Deno.args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);

            // Handle flags without values
            if (key === "sorted") {
                sorted = true;
                continue;
            }

            const value = Deno.args[i + 1];

            if (!value || value.startsWith("--")) {
                console.error(`Error: Missing value for ${arg}`);
                Deno.exit(1);
            }

            switch (key) {
                case "before":
                    options.before = value;
                    break;
                case "after":
                    options.after = value;
                    break;
                case "q":
                case "query":
                    options.query = value;
                    break;
                case "spec":
                    options.spec = value;
                    break;
                case "parallel":
                    parallelChunks = parseInt(value);
                    if (isNaN(parallelChunks) || parallelChunks < 1) {
                        console.error(`Error: --parallel must be a positive integer`);
                        Deno.exit(1);
                    }
                    break;
                default:
                    console.error(`Error: Unknown argument ${arg}`);
                    Deno.exit(1);
            }
            i++; // Skip the value in the next iteration
        }
    }

    // Default to last 30 days if no after/before specified
    if (!options.after && !options.before) {
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        options.after = thirtyDaysAgo;
    }

    try {
        if (sorted) {
            // Buffer all entries and sort them (not streaming)
            console.error("Buffering all entries for sorting...");
            const allEntries: Record<string, unknown>[] = [];

            if (parallelChunks) {
                for await (
                    const entry of getAllAuditLogEntriesParallel(API_KEY, {
                        ...options,
                        parallelChunks,
                        onProgress: (progress) => {
                            switch (progress.type) {
                                case "start":
                                    console.error(
                                        `Fetching audit logs from ${progress.timeRange?.after} to ${progress.timeRange?.before}...`,
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
                    allEntries.push(entry);
                }
            } else {
                for await (const entry of getAllAuditLogEntries(API_KEY, options)) {
                    allEntries.push(entry);
                }
            }

            // Sort by date (oldest first)
            console.error(`Sorting ${allEntries.length.toLocaleString()} entries...`);
            allEntries.sort((a, b) => {
                const aDate = (a.date as number) || 0;
                const bDate = (b.date as number) || 0;
                return aDate - bDate;
            });

            // Output sorted entries
            console.error("Outputting sorted entries...");
            for (const entry of allEntries) {
                console.log(JSON.stringify(entry, null, 0));
            }
        } else if (parallelChunks) {
            // Use parallel fetching with progress logging to stderr (streaming)
            for await (
                const entry of getAllAuditLogEntriesParallel(API_KEY, {
                    ...options,
                    parallelChunks,
                    onProgress: (progress) => {
                        switch (progress.type) {
                            case "start":
                                console.error(
                                    `Fetching audit logs from ${progress.timeRange?.after} to ${progress.timeRange?.before}...`,
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
            for await (const entry of getAllAuditLogEntries(API_KEY, options)) {
                console.log(JSON.stringify(entry, null, 0));
            }
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        Deno.exit(1);
    }
}
