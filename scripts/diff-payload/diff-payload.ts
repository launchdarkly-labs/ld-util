#!/usr/bin/env -S deno run --allow-net --allow-env

import { create } from "npm:jsondiffpatch";
import { format as jsonpatchFormat } from "npm:jsondiffpatch/formatters/jsonpatch";
import { format as consoleFormat } from "npm:jsondiffpatch/formatters/console";
import { parseArgs } from "jsr:@std/cli/parse-args";

// --- Noise field configuration ---
// Fields stripped recursively at any depth.
const RECURSIVE_NOISE = new Set(["_id", "id"]);

// Top-level fields stripped from each flag entry in the polling payload.
// These are version/instance-specific and create noise when comparing.
const FLAG_NOISE = new Set([
    "version",
    "flagVersion",
    "debugEventsUntilDate",
    "salt",
    "sel",
]);

// Top-level fields stripped from each segment entry.
const SEGMENT_NOISE = new Set([
    "version",
    "generation",
    "salt",
]);

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

function cleanFlags(
    flags: Record<string, unknown>,
): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [flagKey, flagValue] of Object.entries(flags)) {
        const flag = flagValue as Record<string, unknown>;
        const cleanedFlag: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(flag)) {
            if (!FLAG_NOISE.has(key) && !RECURSIVE_NOISE.has(key)) {
                cleanedFlag[key] = deepClean(value);
            }
        }
        cleaned[flagKey] = cleanedFlag;
    }
    return cleaned;
}

function cleanSegments(
    segments: Record<string, unknown>,
): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [segKey, segValue] of Object.entries(segments)) {
        const segment = segValue as Record<string, unknown>;
        const cleanedSeg: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(segment)) {
            if (!SEGMENT_NOISE.has(key) && !RECURSIVE_NOISE.has(key)) {
                cleanedSeg[key] = deepClean(value);
            }
        }
        cleaned[segKey] = cleanedSeg;
    }
    return cleaned;
}

// --- Polling endpoint fetch ---

async function fetchPayload(
    sdkKey: string,
    baseUrl: string,
): Promise<Record<string, unknown>> {
    const url = `${baseUrl}/sdk/latest-all`;
    const response = await fetch(url, {
        headers: { "Authorization": sdkKey },
    });

    if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
            `SDK poll failed: ${response.status} ${response.statusText}\nURL: ${url}\nResponse: ${body}`,
        );
    }

    return await response.json();
}

// --- Main ---

async function main() {
    const args = parseArgs(Deno.args, {
        string: ["base-url", "format"],
        boolean: ["help", "include-segments"],
        alias: { h: "help", f: "format" },
        default: { format: "console", "include-segments": true },
    });

    if (args.help || args._.length < 2) {
        console.error(
            `Usage: diff-payload.ts <sdk-key-a> <sdk-key-b> [options]

Compare the SDK polling payloads from two LaunchDarkly environments.
Fetches /sdk/latest-all for each key and diffs the flag/segment rules.

Arguments:
  sdk-key-a     First SDK key (left side of diff)
  sdk-key-b     Second SDK key (right side of diff)

Options:
  --format, -f          Diff format: console (default) | jsonpatch | delta
                          console    Human-readable colored text
                          jsonpatch  RFC 6902 ops array — {op, path, value}
                          delta      Raw jsondiffpatch delta — compact
  --no-include-segments  Exclude segments from the diff
  --base-url            SDK polling base URL (default: https://sdk.launchdarkly.com)
  --help, -h            Show this help message

Environment variables:
  LD_BASE_URL            Alternative to --base-url

Examples:
  diff-payload.ts sdk-xxx-111 sdk-xxx-222
  diff-payload.ts sdk-xxx-111 sdk-xxx-222 --format jsonpatch | jq .
  diff-payload.ts "$SDK_KEY_STAGING" "$SDK_KEY_PROD" -f console`,
        );
        Deno.exit(args.help ? 0 : 1);
    }

    const sdkKeyA = String(args._[0]);
    const sdkKeyB = String(args._[1]);

    const format = args.format as string;
    if (format !== "jsonpatch" && format !== "delta" && format !== "console") {
        console.error(
            `Error: --format must be "jsonpatch", "delta", or "console"`,
        );
        Deno.exit(1);
    }

    const baseUrl = args["base-url"] ||
        Deno.env.get("LD_BASE_URL") ||
        "https://sdk.launchdarkly.com";

    const includeSegments = args["include-segments"] as boolean;

    // Fetch both payloads in parallel
    console.error("Fetching payload A...");
    console.error("Fetching payload B...");
    const [payloadA, payloadB] = await Promise.all([
        fetchPayload(sdkKeyA, baseUrl),
        fetchPayload(sdkKeyB, baseUrl),
    ]);

    const flagsA = (payloadA.flags ?? {}) as Record<string, unknown>;
    const flagsB = (payloadB.flags ?? {}) as Record<string, unknown>;
    console.error(`  A: ${Object.keys(flagsA).length} flags`);
    console.error(`  B: ${Object.keys(flagsB).length} flags`);

    const objectA: Record<string, unknown> = {
        flags: cleanFlags(flagsA),
    };
    const objectB: Record<string, unknown> = {
        flags: cleanFlags(flagsB),
    };

    if (includeSegments) {
        const segsA = (payloadA.segments ?? {}) as Record<string, unknown>;
        const segsB = (payloadB.segments ?? {}) as Record<string, unknown>;
        console.error(`  A: ${Object.keys(segsA).length} segments`);
        console.error(`  B: ${Object.keys(segsB).length} segments`);
        objectA.segments = cleanSegments(segsA);
        objectB.segments = cleanSegments(segsB);
    }

    // Diff
    console.error("Diffing...");
    const differ = create();
    const delta = differ.diff(objectA, objectB);

    // Output
    if (format === "console") {
        if (delta) {
            const out = consoleFormat(delta as never);
            if (out) console.log(out);
            else console.error("No differences found.");
        } else {
            console.error("No differences found.");
        }
    } else if (format === "jsonpatch") {
        console.log(
            JSON.stringify(delta ? jsonpatchFormat(delta as never) : []),
        );
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
                else if (
                    value.length === 3 && value[1] === 0 && value[2] === 0
                ) {
                    onlyLeft++;
                } else changed++;
            } else {
                changed++;
            }
        }
        return {
            changed,
            onlyLeft,
            onlyRight,
            identical: total - changed - onlyLeft - onlyRight,
        };
    }

    const deltaObj = delta as
        | Record<string, Record<string, unknown>>
        | undefined;

    const allFlagKeys = new Set([
        ...Object.keys(flagsA),
        ...Object.keys(flagsB),
    ]);
    const fs = countEntries(deltaObj?.flags, allFlagKeys.size);
    console.error(
        `\nFlags:    ${fs.identical} identical, ${fs.changed} changed, ${fs.onlyLeft} only in A, ${fs.onlyRight} only in B`,
    );

    if (includeSegments) {
        const segsA = (payloadA.segments ?? {}) as Record<string, unknown>;
        const segsB = (payloadB.segments ?? {}) as Record<string, unknown>;
        const allSegKeys = new Set([
            ...Object.keys(segsA),
            ...Object.keys(segsB),
        ]);
        const ss = countEntries(deltaObj?.segments, allSegKeys.size);
        console.error(
            `Segments: ${ss.identical} identical, ${ss.changed} changed, ${ss.onlyLeft} only in A, ${ss.onlyRight} only in B`,
        );
    }
}

main();
