#!/usr/bin/env -S deno run --allow-net --allow-env

interface APIResponse {
    items: Record<string, unknown>[];
    _links: {
        next?: { href: string };
    };
}

export async function* getAllFlagStatuses(
    projectKey: string,
    environmentKey: string,
    apiKey: string,
): AsyncGenerator<Record<string, unknown>> {
    const baseUrl = "https://app.launchdarkly.com/";
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

            // Yield each flag status
            for (const flagStatus of data.items) {
                yield flagStatus;
            }

            // Get next page URL if it exists
            nextUrl = data._links?.next?.href || "";
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
    const API_KEY = Deno.env.get("LD_API_KEY");
    if (!API_KEY) {
        console.error(
            "Error: LD_API_KEY environment variable is required",
        );
        Deno.exit(1);
    }

    const projectKey = Deno.args[0];
    if (!projectKey) {
        console.error("Error: Project key argument is required");
        console.error("Usage: get-all-flag-statuses.ts <project-key> <environment-key>");
        Deno.exit(1);
    }

    const environmentKey = Deno.args[1];
    if (!environmentKey) {
        console.error("Error: Environment key argument is required");
        console.error("Usage: get-all-flag-statuses.ts <project-key> <environment-key>");
        Deno.exit(1);
    }

    for await (const flagStatus of getAllFlagStatuses(projectKey, environmentKey, API_KEY)) {
        console.log(JSON.stringify(flagStatus, null, 0));
    }
}

