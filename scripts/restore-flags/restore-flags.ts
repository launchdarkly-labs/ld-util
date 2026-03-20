#!/usr/bin/env -S deno run --allow-net --allow-env

/**
 * Reads flag JSONL from stdin and PATCHes each flag's environment config
 * back using JSON Patch (RFC 6902).
 *
 * Usage:
 *   cat deleted-flags.jsonl | restore-flags.ts [--execute]
 *
 * Without --execute, runs in dry-run mode and prints what would be patched.
 */

const LD_API_KEY = Deno.env.get("LD_API_KEY");
const LD_API_URL = Deno.env.get("LD_API_ENDPOINT") || "https://app.launchdarkly.com";

if (!LD_API_KEY) {
    console.error("Error: LD_API_KEY environment variable is required");
    Deno.exit(1);
}

const execute = Deno.args.includes("--execute");

function log(message: string) {
    Deno.stderr.writeSync(new TextEncoder().encode(message + "\n"));
}

async function fetchWithRateLimitRetry(request: Request): Promise<Response> {
    const retryRequest = request.clone();
    let response = await fetch(request);
    while (response.status === 429) {
        const reset = response.headers.get("X-Ratelimit-Reset");
        const waitMs = reset ? Math.max(Number(reset) - Date.now(), 500) : 1000;
        log(`  rate limited, waiting ${waitMs}ms...`);
        await new Promise((r) => setTimeout(r, waitMs));
        response = await fetch(retryRequest.clone());
    }
    return response;
}

/** Fields we want to restore per environment */
const ENV_FIELDS = [
    "on",
    "archived",
    "targets",
    "contextTargets",
    "rules",
    "fallthrough",
    "offVariation",
    "prerequisites",
    "trackEvents",
    "trackEventsFallthrough",
] as const;

/** Recursively strip _id fields from objects and arrays */
function stripIds(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripIds);
    if (value !== null && typeof value === "object") {
        const cleaned: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (k !== "_id") cleaned[k] = stripIds(v);
        }
        return cleaned;
    }
    return value;
}

interface JsonPatchOp {
    op: "replace";
    path: string;
    value: unknown;
}

function buildPatchOps(
    envKey: string,
    envConfig: Record<string, unknown>,
): JsonPatchOp[] {
    const ops: JsonPatchOp[] = [];
    for (const field of ENV_FIELDS) {
        if (field in envConfig) {
            ops.push({
                op: "replace",
                path: `/environments/${envKey}/${field}`,
                value: stripIds(envConfig[field]),
            });
        }
    }
    return ops;
}

// --- Main ---

const text = await new Response(Deno.stdin.readable).text();
const lines = text.trim().split("\n").filter(Boolean);

log(`Loaded ${lines.length} flags from stdin`);
if (!execute) {
    log("Dry run mode. Pass --execute to apply changes.\n");
}

let successCount = 0;
let failCount = 0;

for (const [i, line] of lines.entries()) {
    let flag: Record<string, unknown>;
    try {
        flag = JSON.parse(line);
    } catch {
        log(`SKIP line ${i + 1}: invalid JSON`);
        continue;
    }
    const key = flag.key as string;
    const projectPath = (flag._links as Record<string, Record<string, string>>)
        .parent.href; // e.g. /api/v2/flags/aman-migration_v1
    const environments = flag.environments as Record<string, Record<string, unknown>>;

    for (const [envKey, envConfig] of Object.entries(environments)) {
        const ops = buildPatchOps(envKey, envConfig);

        if (!execute) {
            log(`[dry-run] ${key} / ${envKey}: ${ops.length} ops`);
            console.log(JSON.stringify(ops, null, 0))
            continue;
        }

        const url = new URL(`${projectPath}/${key}`, LD_API_URL);
        const response = await fetchWithRateLimitRetry(
            new Request(url, {
                method: "PATCH",
                headers: {
                    Authorization: LD_API_KEY,
                    "Content-Type": "application/json-patch+json",
                },
                body: JSON.stringify({
                    comment: `Restoring ${envKey} environment config via ld-util/restore-flags`,
                    patch: ops,
                }),
            }),
        );

        if (response.ok) {
            log(`OK ${key} / ${envKey}`);
            successCount++;
        } else {
            const body = await response.text().catch(() => "");
            log(`FAIL ${key} / ${envKey}: ${response.status} ${body}`);
            failCount++;
        }
    }
}

if (execute) {
    log(`\nDone. ${successCount} succeeded, ${failCount} failed.`);
}
