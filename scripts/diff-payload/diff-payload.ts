#!/usr/bin/env -S deno run --allow-net --allow-env

import { parseArgs } from "jsr:@std/cli/parse-args";
import { type DiffFormat, diffPayloads, fetchSDKPayload } from "./mod.ts";

const args = parseArgs(Deno.args, {
    string: ["base-url", "format", "stream-url"],
    boolean: ["help", "include-segments", "live"],
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
  --live                 Stream mode — continuously diff via SSE streaming
  --no-include-segments  Exclude segments from the diff
  --base-url            SDK polling base URL (default: https://sdk.launchdarkly.com)
  --stream-url          SDK streaming base URL (live mode only)
  --help, -h            Show this help message

Environment variables:
  LD_BASE_URL            Alternative to --base-url
  LD_STREAM_URL          Alternative to --stream-url

Examples:
  diff-payload.ts sdk-xxx-111 sdk-xxx-222
  diff-payload.ts sdk-xxx-111 sdk-xxx-222 --format jsonpatch | jq .
  diff-payload.ts "$SDK_KEY_STAGING" "$SDK_KEY_PROD" -f console`,
    );
    Deno.exit(args.help ? 0 : 1);
}

const sdkKeyA = String(args._[0]);
const sdkKeyB = String(args._[1]);
const includeSegments = args["include-segments"] as boolean;

if (args.live) {
    const { startLiveMode } = await import("./live-diff.ts");
    const streamUrl = args["stream-url"] as string ||
        Deno.env.get("LD_STREAM_URL");
    await startLiveMode({ sdkKeyA, sdkKeyB, includeSegments, streamUrl });
    Deno.exit(0); // unreachable — startLiveMode exits
}

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

// Fetch both payloads in parallel
console.error("Fetching payload A...");
console.error("Fetching payload B...");
const [payloadA, payloadB] = await Promise.all([
    fetchSDKPayload(sdkKeyA, baseUrl),
    fetchSDKPayload(sdkKeyB, baseUrl),
]);

const flagsA = (payloadA.flags ?? {}) as Record<string, unknown>;
const flagsB = (payloadB.flags ?? {}) as Record<string, unknown>;
console.error(`  A: ${Object.keys(flagsA).length} flags`);
console.error(`  B: ${Object.keys(flagsB).length} flags`);

if (includeSegments) {
    const segsA = (payloadA.segments ?? {}) as Record<string, unknown>;
    const segsB = (payloadB.segments ?? {}) as Record<string, unknown>;
    console.error(`  A: ${Object.keys(segsA).length} segments`);
    console.error(`  B: ${Object.keys(segsB).length} segments`);
}

// Diff
console.error("Diffing...");
const result = diffPayloads(payloadA, payloadB, {
    includeSegments,
    format: format as DiffFormat,
});

// Output
if (format === "console") {
    if (result.formatted) {
        console.log(result.formatted);
    } else {
        console.error("No differences found.");
    }
} else {
    console.log(result.formatted);
}

// Summary
const fs = result.flags;
console.error(
    `\nFlags:    ${fs.identical} identical, ${fs.changed} changed, ${fs.onlyLeft} only in A, ${fs.onlyRight} only in B`,
);

if (includeSegments && result.segments) {
    const ss = result.segments;
    console.error(
        `Segments: ${ss.identical} identical, ${ss.changed} changed, ${ss.onlyLeft} only in A, ${ss.onlyRight} only in B`,
    );
}
