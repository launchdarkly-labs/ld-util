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

    for (let i = 0; i < Deno.args.length; i++) {
        const arg = Deno.args[i];
        if (arg.startsWith("--")) {
            const key = arg.slice(2);
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
        for await (const entry of getAllAuditLogEntries(API_KEY, options)) {
            console.log(JSON.stringify(entry, null, 0));
        }
    } catch (error) {
        console.error(`Error: ${error.message}`);
        Deno.exit(1);
    }
}
