#!/usr/bin/env -S deno run --allow-net --allow-env

import { create } from "npm:jsondiffpatch";
import { format as jsonpatchFormat } from "npm:jsondiffpatch/formatters/jsonpatch";
import { format as consoleFormat } from "npm:jsondiffpatch/formatters/console";
import { parseArgs } from "jsr:@std/cli/parse-args";

// --- Noise field configuration ---
// Fields that are instance-specific and will never match across projects.
// Stripped recursively at any depth (rules, clauses, targets all have _id).
const RECURSIVE_NOISE = new Set(["_id", "_links"]);

// Additional top-level fields stripped from environment configs
const ENV_NOISE = new Set([
    "salt",
    "lastModified",
    "version",
    "_site",
    "_environmentName",
    "_summary",
    "sel",
]);

// Top-level fields stripped from flag objects (environments rebuilt separately)
const FLAG_NOISE = new Set([
    "_version",
    "creationDate",
    "_debugEventsUntilDate",
    "environments",
]);

// Fields stripped from segment objects
const SEGMENT_NOISE = new Set([
    "creationDate",
    "lastModifiedDate",
    "version",
    "generation",
]);

// --- Types ---

interface APIResponse {
    items: Record<string, unknown>[];
    _links: {
        next?: { href: string };
    };
}

// --- Cleaning helpers ---

function deepClean(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    if (Array.isArray(value)) {
        return value.map((item) => deepClean(item));
    }

    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (
            const [key, val] of Object.entries(
                value as Record<string, unknown>,
            )
        ) {
            if (!RECURSIVE_NOISE.has(key)) {
                result[key] = deepClean(val);
            }
        }
        return result;
    }

    return value;
}

function cleanFlagLevel(
    flag: Record<string, unknown>,
): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(flag)) {
        if (!FLAG_NOISE.has(key) && !RECURSIVE_NOISE.has(key)) {
            cleaned[key] = deepClean(value);
        }
    }
    return cleaned;
}

function cleanEnvConfig(
    env: Record<string, unknown>,
): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(env)) {
        if (!ENV_NOISE.has(key) && !RECURSIVE_NOISE.has(key)) {
            cleaned[key] = deepClean(value);
        }
    }
    return cleaned;
}

function cleanSegment(
    segment: Record<string, unknown>,
): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(segment)) {
        if (!SEGMENT_NOISE.has(key) && !RECURSIVE_NOISE.has(key)) {
            cleaned[key] = deepClean(value);
        }
    }
    return cleaned;
}

// --- API fetching ---

async function* fetchPaginated(
    initialUrl: URL,
    apiKey: string,
    baseUrl: string,
): AsyncGenerator<Record<string, unknown>> {
    let nextUrl: URL | null = initialUrl;

    while (nextUrl) {
        try {
            const response = await fetch(nextUrl, {
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
                    await new Promise((resolve) =>
                        setTimeout(resolve, Math.max(waitMs, 100))
                    );
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
                    `API request failed: ${response.status} ${response.statusText}\nURL: ${nextUrl}\nResponse: ${errorBody}`,
                );
            }

            const data: APIResponse = await response.json();
            for (const item of data.items) yield item;

            nextUrl = data._links?.next?.href
                ? new URL(data._links.next.href, baseUrl)
                : null;
        } catch (error) {
            if (
                error instanceof TypeError && error.message.includes("fetch")
            ) {
                await new Promise((resolve) => setTimeout(resolve, 1000));
                continue;
            }
            throw error;
        }
    }
}

function flagsUrl(
    projectKey: string,
    baseUrl: string,
    envKey: string,
): URL {
    const url = new URL(`/api/v2/flags/${projectKey}`, baseUrl);
    url.searchParams.set("summary", "0");
    url.searchParams.set("env", envKey);
    return url;
}

function segmentsUrl(
    projectKey: string,
    baseUrl: string,
    envKey: string,
): URL {
    return new URL(`/api/v2/segments/${projectKey}/${envKey}`, baseUrl);
}

async function collectFlags(
    projectKey: string,
    apiKey: string,
    baseUrl: string,
    environments: string[],
): Promise<Map<string, Record<string, unknown>>> {
    const flags = new Map<string, Record<string, unknown>>();

    // Fetch each environment separately — a single env=X&summary=0 request returns
    // the full targeting rules (clauses, rollouts, etc.), whereas mixing multiple
    // env params in one request gives a summarized view without rule details.
    for (const envKey of environments) {
        console.error(`  env "${envKey}"...`);
        for await (
            const flag of fetchPaginated(
                flagsUrl(projectKey, baseUrl, envKey),
                apiKey,
                baseUrl,
            )
        ) {
            const key = flag.key as string;
            const flagEnvs = (flag.environments as Record<string, unknown>) ??
                {};

            if (!flags.has(key)) {
                flags.set(key, {
                    ...flag,
                    environments: flagEnvs[envKey]
                        ? { [envKey]: flagEnvs[envKey] }
                        : {},
                });
            } else {
                const existing = flags.get(key)!;
                const existingEnvs = existing.environments as Record<
                    string,
                    unknown
                >;
                if (flagEnvs[envKey]) {
                    existingEnvs[envKey] = flagEnvs[envKey];
                }
            }
        }
    }

    return flags;
}

async function collectSegments(
    projectKey: string,
    apiKey: string,
    baseUrl: string,
    environments: string[],
): Promise<Map<string, Record<string, unknown>>> {
    const segments = new Map<string, Record<string, unknown>>();

    for (const envKey of environments) {
        console.error(`  env "${envKey}"...`);
        for await (
            const segment of fetchPaginated(
                segmentsUrl(projectKey, baseUrl, envKey),
                apiKey,
                baseUrl,
            )
        ) {
            const key = segment.key as string;
            if (!segments.has(key)) {
                segments.set(key, { environments: {} });
            }
            const envs = (segments.get(key)!.environments) as Record<
                string,
                unknown
            >;
            envs[envKey] = cleanSegment(segment);
        }
    }

    return segments;
}

// --- Diff logic ---

function buildFlagsObject(
    flags: Map<string, Record<string, unknown>>,
    environments: string[],
): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, flag] of flags) {
        const flagLevel = cleanFlagLevel(flag);
        const rawEnvs = (flag.environments ?? {}) as Record<
            string,
            Record<string, unknown>
        >;
        const cleanedEnvs: Record<string, unknown> = {};
        for (const envKey of environments) {
            if (rawEnvs[envKey]) {
                cleanedEnvs[envKey] = cleanEnvConfig(rawEnvs[envKey]);
            }
        }
        obj[key] = { ...flagLevel, environments: cleanedEnvs };
    }
    return obj;
}

function buildSegmentsObject(
    segments: Map<string, Record<string, unknown>>,
): Record<string, unknown> {
    const obj: Record<string, unknown> = {};
    for (const [key, segment] of segments) {
        obj[key] = segment;
    }
    return obj;
}

// --- Main ---

async function main() {
    const args = parseArgs(Deno.args, {
        string: ["env", "base-url", "format"],
        collect: ["env"],
        boolean: ["help"],
        alias: { h: "help", e: "env", f: "format" },
        default: { format: "jsonpatch" },
    });

    if (args.help || args._.length < 2) {
        console.error(
            `Usage: diff-projects.ts <project-a> <project-b> --env <env> [--env <env> ...]

Compare feature flags and segments between two LaunchDarkly projects.
Outputs a single diff object: { flags: {...}, segments: {...} }.

Arguments:
  project-a    First project key (left side of diff)
  project-b    Second project key (right side of diff)

Options:
  --env, -e      Environment key(s) to compare (required, repeatable)
  --format, -f   Diff format: jsonpatch (default) | delta | console
                   jsonpatch  RFC 6902 ops array — {op, path, value}
                   delta      Raw jsondiffpatch delta — compact but opaque
                   console    Human-readable colored text (not NDJSON)
  --base-url     LaunchDarkly API base URL (default: https://app.launchdarkly.com/)
  --help, -h     Show this help message

Environment variables:
  LD_API_KEY or LAUNCHDARKLY_API_KEY    API key (required)
  LAUNCHDARKLY_BASE_URI                 Alternative to --base-url

Examples:
  diff-projects.ts project-a project-b --env production
  diff-projects.ts project-a project-b -e production -e staging
  diff-projects.ts project-a project-b -e production | jq .`,
        );
        Deno.exit(args.help ? 0 : 1);
    }

    const API_KEY = Deno.env.get("LAUNCHDARKLY_API_KEY") ||
        Deno.env.get("LD_API_KEY");
    if (!API_KEY) {
        console.error(
            "Error: LAUNCHDARKLY_API_KEY or LD_API_KEY environment variable is required",
        );
        Deno.exit(1);
    }

    const projectA = String(args._[0]);
    const projectB = String(args._[1]);
    const environments = args.env as string[];

    if (!environments || environments.length === 0) {
        console.error("Error: At least one --env is required");
        Deno.exit(1);
    }

    const format = args.format as string;
    if (format !== "jsonpatch" && format !== "delta" && format !== "console") {
        console.error(`Error: --format must be "jsonpatch", "delta", or "console"`);
        Deno.exit(1);
    }

    const baseUrl = args["base-url"] ||
        Deno.env.get("LAUNCHDARKLY_BASE_URI") ||
        "https://app.launchdarkly.com/";

    console.error(`Fetching flags from "${projectA}"...`);
    const flagsA = await collectFlags(projectA, API_KEY, baseUrl, environments);
    console.error(`  ${flagsA.size} flags`);

    console.error(`Fetching segments from "${projectA}"...`);
    const segsA = await collectSegments(projectA, API_KEY, baseUrl, environments);
    console.error(`  ${segsA.size} segments`);

    console.error(`Fetching flags from "${projectB}"...`);
    const flagsB = await collectFlags(projectB, API_KEY, baseUrl, environments);
    console.error(`  ${flagsB.size} flags`);

    console.error(`Fetching segments from "${projectB}"...`);
    const segsB = await collectSegments(projectB, API_KEY, baseUrl, environments);
    console.error(`  ${segsB.size} segments`);

    // Diff
    console.error("Diffing...");
    const differ = create();
    const objectA = {
        flags: buildFlagsObject(flagsA, environments),
        segments: buildSegmentsObject(segsA),
    };
    const objectB = {
        flags: buildFlagsObject(flagsB, environments),
        segments: buildSegmentsObject(segsB),
    };
    const delta = differ.diff(objectA, objectB);

    // Output
    if (format === "console") {
        if (delta) {
            const out = consoleFormat(delta as never);
            if (out) console.log(out);
        }
    } else if (format === "jsonpatch") {
        console.log(JSON.stringify(delta ? jsonpatchFormat(delta as never) : []));
    } else {
        console.log(JSON.stringify(delta ?? {}));
    }

    // Summary
    function countEntries(
        subDelta: Record<string, unknown> | undefined,
        total: number,
    ) {
        let changed = 0, onlyLeft = 0, onlyRight = 0;
        for (const value of Object.values(subDelta ?? {})) {
            if (Array.isArray(value)) {
                if (value.length === 1) onlyRight++;
                else if (value.length === 3 && value[1] === 0 && value[2] === 0) {
                    onlyLeft++;
                } else changed++;
            } else {
                changed++;
            }
        }
        return { changed, onlyLeft, onlyRight, identical: total - changed - onlyLeft - onlyRight };
    }

    const deltaObj = delta as Record<string, Record<string, unknown>> | undefined;
    const fs = countEntries(
        deltaObj?.flags,
        new Set([...flagsA.keys(), ...flagsB.keys()]).size,
    );
    const ss = countEntries(
        deltaObj?.segments,
        new Set([...segsA.keys(), ...segsB.keys()]).size,
    );

    console.error(`\nFlags:    ${fs.identical} identical, ${fs.changed} changed, ${fs.onlyLeft} only in ${projectA}, ${fs.onlyRight} only in ${projectB}`);
    console.error(`Segments: ${ss.identical} identical, ${ss.changed} changed, ${ss.onlyLeft} only in ${projectA}, ${ss.onlyRight} only in ${projectB}`);
}

main();
