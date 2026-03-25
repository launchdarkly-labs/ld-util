import { create } from "npm:jsondiffpatch";
import { format as consoleFormat } from "npm:jsondiffpatch/formatters/console";
import { format as jsonpatchFormat } from "npm:jsondiffpatch/formatters/jsonpatch";

// --- Types ---

interface DataKind {
    namespace: string;
}

interface StoreItem {
    key?: string;
    deleted?: boolean;
    version: number;
    [attr: string]: unknown;
}

type KindData = Record<string, StoreItem>;
type DataStorage = Record<string, KindData>;

export interface LiveModeOptions {
    sdkKeyA: string;
    sdkKeyB: string;
    includeSegments: boolean;
    streamUrl?: string;
}

interface ColumnChanges {
    added: number;
    removed: number;
    modified: number;
}

const EMPTY_CHANGES: ColumnChanges = { added: 0, removed: 0, modified: 0 };

interface FlagAnalysis {
    key: string;
    status: "changed" | "only-left" | "only-right";
    targets: ColumnChanges;
    rules: ColumnChanges;
    defaults: ColumnChanges;
    variations: ColumnChanges;
}

interface SegmentAnalysis {
    key: string;
    status: "changed" | "only-left" | "only-right";
    members: ColumnChanges;
    rules: ColumnChanges;
}

interface AnalysisResult {
    flags: FlagAnalysis[];
    segments: SegmentAnalysis[];
}

// --- Noise fields ---

const RECURSIVE_NOISE = new Set(["_id", "id"]);

const FLAG_NOISE = new Set([
    "version", "flagVersion", "debugEventsUntilDate", "salt", "sel",
]);

const SEGMENT_NOISE = new Set(["version", "generation", "salt"]);

function deepClean(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) return value.map(deepClean);
    if (typeof value === "object") {
        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (!RECURSIVE_NOISE.has(k)) result[k] = deepClean(v);
        }
        return result;
    }
    return value;
}

function cleanItem(item: Record<string, unknown>, noiseFields: Set<string>): Record<string, unknown> {
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(item)) {
        if (!noiseFields.has(k) && !RECURSIVE_NOISE.has(k)) {
            cleaned[k] = deepClean(v);
        }
    }
    return cleaned;
}

// --- CaptureStore ---

class CaptureStore {
    private data: DataStorage = {};
    private _initialized = false;
    private onChange: () => void;

    constructor(onChange: () => void) {
        this.onChange = onChange;
    }

    get(kind: DataKind, key: string, callback: (res: StoreItem | null) => void): void {
        const items = this.data[kind.namespace];
        const item = items?.[key];
        callback(item && !item.deleted ? item : null);
    }

    all(kind: DataKind, callback: (res: KindData) => void): void {
        const items = this.data[kind.namespace] ?? {};
        const result: KindData = {};
        for (const [key, item] of Object.entries(items)) {
            if (!item.deleted) result[key] = item;
        }
        callback(result);
    }

    init(allData: DataStorage, callback: () => void): void {
        this.data = {};
        for (const [namespace, items] of Object.entries(allData)) {
            this.data[namespace] = { ...items };
        }
        this._initialized = true;
        callback();
        this.onChange();
    }

    upsert(kind: DataKind, data: StoreItem & { key: string }, callback: () => void): void {
        const ns = kind.namespace;
        if (!this.data[ns]) this.data[ns] = {};
        const existing = this.data[ns][data.key];
        if (!existing || data.version > existing.version) {
            this.data[ns][data.key] = data;
            callback();
            this.onChange();
        } else {
            callback();
        }
    }

    delete(kind: DataKind, key: string, version: number, callback: () => void): void {
        const ns = kind.namespace;
        if (!this.data[ns]) this.data[ns] = {};
        const existing = this.data[ns][key];
        if (!existing || version > existing.version) {
            this.data[ns][key] = { deleted: true, version };
            callback();
            this.onChange();
        } else {
            callback();
        }
    }

    initialized(callback: (isInitialized: boolean) => void): void {
        callback(this._initialized);
    }

    close(): void {}

    getDescription(): string {
        return "CaptureStore";
    }

    toPayload(): Record<string, unknown> {
        const payload: Record<string, Record<string, StoreItem>> = {};
        const namespaceMap: Record<string, string> = { features: "flags", segments: "segments" };
        for (const [ns, items] of Object.entries(this.data)) {
            const key = namespaceMap[ns] ?? ns;
            payload[key] = {};
            for (const [k, item] of Object.entries(items)) {
                if (!item.deleted) payload[key][k] = item;
            }
        }
        return payload;
    }
}

// --- Per-item analysis ---

const differ = create();

function countArrayDelta(delta: unknown): ColumnChanges {
    if (!delta || typeof delta !== "object") return { ...EMPTY_CHANGES };
    const d = delta as Record<string, unknown>;

    if (d._t === "a") {
        let added = 0, removed = 0, modified = 0;
        for (const [key, val] of Object.entries(d)) {
            if (key === "_t") continue;
            if (key.startsWith("_")) {
                if (Array.isArray(val) && val.length === 3 && val[1] === 0 && val[2] === 0) removed++;
            } else if (Array.isArray(val) && val.length === 1) {
                added++;
            } else {
                modified++;
            }
        }
        return { added, removed, modified };
    }

    if (Array.isArray(delta)) {
        if (delta.length === 1) return { added: 1, removed: 0, modified: 0 };
        if (delta.length === 3 && delta[1] === 0 && delta[2] === 0) return { added: 0, removed: 1, modified: 0 };
        return { added: 0, removed: 0, modified: 1 };
    }

    return { added: 0, removed: 0, modified: 1 };
}

function countObjectDelta(delta: unknown): ColumnChanges {
    if (!delta || typeof delta !== "object") return { ...EMPTY_CHANGES };

    if (Array.isArray(delta)) {
        if (delta.length === 1) return { added: 1, removed: 0, modified: 0 };
        if (delta.length === 3 && delta[1] === 0 && delta[2] === 0) return { added: 0, removed: 1, modified: 0 };
        return { added: 0, removed: 0, modified: 1 };
    }

    const d = delta as Record<string, unknown>;
    let added = 0, removed = 0, modified = 0;
    for (const [, val] of Object.entries(d)) {
        if (Array.isArray(val)) {
            if (val.length === 1) added++;
            else if (val.length === 3 && val[1] === 0 && val[2] === 0) removed++;
            else modified++;
        } else {
            modified++;
        }
    }
    return { added, removed, modified };
}

function mergeChanges(a: ColumnChanges, b: ColumnChanges): ColumnChanges {
    return { added: a.added + b.added, removed: a.removed + b.removed, modified: a.modified + b.modified };
}

function hasChanges(c: ColumnChanges): boolean {
    return c.added > 0 || c.removed > 0 || c.modified > 0;
}

const FLAG_TARGETS = new Set(["targets", "contextTargets"]);
const FLAG_RULES = new Set(["rules", "prerequisites"]);
const FLAG_DEFAULTS = new Set(["fallthrough", "offVariation"]);
const FLAG_VARIATIONS = new Set(["variations"]);

const SEG_MEMBERS = new Set(["included", "excluded", "includedContexts", "excludedContexts"]);
const SEG_RULES = new Set(["rules"]);

function analyzePayloads(
    payloadA: Record<string, unknown>,
    payloadB: Record<string, unknown>,
    includeSegments: boolean,
): AnalysisResult {
    const flagsA = (payloadA.flags ?? {}) as Record<string, Record<string, unknown>>;
    const flagsB = (payloadB.flags ?? {}) as Record<string, Record<string, unknown>>;
    const allFlagKeys = new Set([...Object.keys(flagsA), ...Object.keys(flagsB)]);

    const flags: FlagAnalysis[] = [];
    for (const key of [...allFlagKeys].sort()) {
        const a = flagsA[key];
        const b = flagsB[key];

        if (!a) {
            flags.push({ key, status: "only-right", targets: EMPTY_CHANGES, rules: EMPTY_CHANGES, defaults: EMPTY_CHANGES, variations: EMPTY_CHANGES });
            continue;
        }
        if (!b) {
            flags.push({ key, status: "only-left", targets: EMPTY_CHANGES, rules: EMPTY_CHANGES, defaults: EMPTY_CHANGES, variations: EMPTY_CHANGES });
            continue;
        }

        const cleanA = cleanItem(a, FLAG_NOISE);
        const cleanB = cleanItem(b, FLAG_NOISE);
        const delta = differ.diff(cleanA, cleanB) as Record<string, unknown> | undefined;
        if (!delta) continue;

        let targets: ColumnChanges = { ...EMPTY_CHANGES };
        let rules: ColumnChanges = { ...EMPTY_CHANGES };
        let defaults: ColumnChanges = { ...EMPTY_CHANGES };
        let variations: ColumnChanges = { ...EMPTY_CHANGES };

        for (const [field, fieldDelta] of Object.entries(delta)) {
            if (FLAG_TARGETS.has(field)) targets = mergeChanges(targets, countArrayDelta(fieldDelta));
            else if (FLAG_RULES.has(field)) rules = mergeChanges(rules, countArrayDelta(fieldDelta));
            else if (FLAG_DEFAULTS.has(field)) defaults = mergeChanges(defaults, countObjectDelta(fieldDelta));
            else if (FLAG_VARIATIONS.has(field)) variations = mergeChanges(variations, countArrayDelta(fieldDelta));
        }

        flags.push({ key, status: "changed", targets, rules, defaults, variations });
    }

    const segments: SegmentAnalysis[] = [];
    if (includeSegments) {
        const segsA = (payloadA.segments ?? {}) as Record<string, Record<string, unknown>>;
        const segsB = (payloadB.segments ?? {}) as Record<string, Record<string, unknown>>;
        const allSegKeys = new Set([...Object.keys(segsA), ...Object.keys(segsB)]);

        for (const key of [...allSegKeys].sort()) {
            const a = segsA[key];
            const b = segsB[key];

            if (!a) {
                segments.push({ key, status: "only-right", members: EMPTY_CHANGES, rules: EMPTY_CHANGES });
                continue;
            }
            if (!b) {
                segments.push({ key, status: "only-left", members: EMPTY_CHANGES, rules: EMPTY_CHANGES });
                continue;
            }

            const cleanA = cleanItem(a, SEGMENT_NOISE);
            const cleanB = cleanItem(b, SEGMENT_NOISE);
            const delta = differ.diff(cleanA, cleanB) as Record<string, unknown> | undefined;
            if (!delta) continue;

            let members: ColumnChanges = { ...EMPTY_CHANGES };
            let segRules: ColumnChanges = { ...EMPTY_CHANGES };

            for (const [field, fieldDelta] of Object.entries(delta)) {
                if (SEG_MEMBERS.has(field)) members = mergeChanges(members, countArrayDelta(fieldDelta));
                else if (SEG_RULES.has(field)) segRules = mergeChanges(segRules, countArrayDelta(fieldDelta));
            }

            segments.push({ key, status: "changed", members, rules: segRules });
        }
    }

    return { flags, segments };
}

// --- Semantic detail renderer ---

// deno-lint-ignore no-explicit-any
type AnyObj = Record<string, any>;

const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const R = "\x1b[0m";

function fmtVariation(idx: number, variations: unknown[]): string {
    const val = variations[idx];
    if (val === undefined) return `variation ${idx}`;
    return `variation ${idx} ${DIM}(${JSON.stringify(val)})${R}`;
}

function fmtServe(obj: AnyObj, variations: unknown[]): string {
    if (obj.rollout) {
        const buckets = (obj.rollout.variations ?? []) as AnyObj[];
        const parts = buckets.map((b: AnyObj) =>
            `${(b.weight / 1000).toFixed(0)}% ${fmtVariation(b.variation, variations)}`
        );
        return `rollout [${parts.join(", ")}]`;
    }
    if (obj.variation !== undefined) {
        return fmtVariation(obj.variation, variations);
    }
    return JSON.stringify(obj);
}

function fmtClause(clause: AnyObj): string {
    const ctx = clause.contextKind && clause.contextKind !== "user"
        ? `${clause.contextKind}.`
        : "";
    const neg = clause.negate ? "NOT " : "";
    const op = clause.op as string;

    if (op === "segmentMatch") {
        const segs = (clause.values as string[]).join(", ");
        return `${neg}in segment [${segs}]`;
    }

    const vals = clause.values as unknown[];
    const valStr = vals.length === 1 ? JSON.stringify(vals[0]) : JSON.stringify(vals);
    return `${neg}${ctx}${clause.attribute} ${op} ${valStr}`;
}

function renderRule(rule: AnyObj, variations: unknown[], indent: string): string[] {
    const lines: string[] = [];
    const clauses = (rule.clauses ?? []) as AnyObj[];
    for (let i = 0; i < clauses.length; i++) {
        const prefix = i === 0 ? "IF " : "AND ";
        lines.push(`${indent}  ${prefix}${fmtClause(clauses[i])}`);
    }
    lines.push(`${indent}  SERVE ${fmtServe(rule, variations)}`);
    if (rule.trackEvents) lines.push(`${indent}  ${DIM}track events${R}`);
    return lines;
}

function sectionHeader(title: string): string {
    return `  ${BOLD}─ ${title} ${"─".repeat(Math.max(0, 40 - title.length))}${R}`;
}

/** Render a line with a +/- /~ prefix and color. */
function added(text: string): string { return `  ${GREEN}+ ${text}${R}`; }
function removed(text: string): string { return `  ${RED}- ${text}${R}`; }
function modified(label: string): string {
    const arrow = label.indexOf(" → ");
    if (arrow === -1) return `  ${YELLOW}~ ${label}${R}`;
    const before = label.slice(0, arrow);
    const after = label.slice(arrow + 3);
    return `  ${YELLOW}~ ${before}${R} → ${GREEN}${after}${R}`;
}
function unchanged(text: string): string { return `    ${DIM}${text}${R}`; }

function deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function renderFlagDetail(
    flagA: AnyObj | undefined,
    flagB: AnyObj | undefined,
): string[] {
    if (!flagA && !flagB) return ["  No data."];

    // Only in one side
    if (!flagA) {
        return renderWholeFlag(flagB!, GREEN, "+");
    }
    if (!flagB) {
        return renderWholeFlag(flagA!, RED, "-");
    }

    const a = cleanItem(flagA, FLAG_NOISE) as AnyObj;
    const b = cleanItem(flagB, FLAG_NOISE) as AnyObj;

    const varsA = (a.variations ?? []) as unknown[];
    const varsB = (b.variations ?? []) as unknown[];
    // Use B's variations for resolving indices (the "current" state)
    const vars = varsB.length >= varsA.length ? varsB : varsA;

    const lines: string[] = [];

    // --- On state ---
    if (a.on !== b.on) {
        lines.push(sectionHeader("State"));
        lines.push(modified(`on: ${a.on} → ${b.on}`));
        lines.push("");
    }

    // --- Variations ---
    if (!deepEqual(a.variations, b.variations)) {
        lines.push(sectionHeader("Variations"));
        const maxLen = Math.max(varsA.length, varsB.length);
        for (let i = 0; i < maxLen; i++) {
            const va = varsA[i];
            const vb = varsB[i];
            if (i >= varsA.length) {
                lines.push(added(`[${i}] ${JSON.stringify(vb)}`));
            } else if (i >= varsB.length) {
                lines.push(removed(`[${i}] ${JSON.stringify(va)}`));
            } else if (!deepEqual(va, vb)) {
                lines.push(modified(`[${i}] ${JSON.stringify(va)} → ${JSON.stringify(vb)}`));
            } else {
                lines.push(unchanged(`[${i}] ${JSON.stringify(va)}`));
            }
        }
        lines.push("");
    }

    // --- Targets ---
    const targetsChanged = !deepEqual(a.targets, b.targets) || !deepEqual(a.contextTargets, b.contextTargets);
    if (targetsChanged) {
        lines.push(sectionHeader("Targets"));
        renderTargetsDiff(lines, a, b, vars);
        lines.push("");
    }

    // --- Rules ---
    if (!deepEqual(a.rules, b.rules)) {
        lines.push(sectionHeader("Rules"));
        renderRulesDiff(lines, a, b, vars);
        lines.push("");
    }

    // --- Prerequisites ---
    if (!deepEqual(a.prerequisites, b.prerequisites)) {
        lines.push(sectionHeader("Prerequisites"));
        renderPrereqsDiff(lines, a, b);
        lines.push("");
    }

    // --- Defaults ---
    const ftChanged = !deepEqual(a.fallthrough, b.fallthrough);
    const ovChanged = a.offVariation !== b.offVariation;
    if (ftChanged || ovChanged) {
        lines.push(sectionHeader("Defaults"));
        if (ftChanged) {
            lines.push(modified(`fallthrough: ${fmtServe(a.fallthrough ?? {}, vars)} → ${fmtServe(b.fallthrough ?? {}, vars)}`));
        }
        if (ovChanged) {
            lines.push(modified(`off variation: ${fmtVariation(a.offVariation, vars)} → ${fmtVariation(b.offVariation, vars)}`));
        }
        lines.push("");
    }

    // --- Catch-all: other changed fields ---
    const handled = new Set([
        "on", "variations", "targets", "contextTargets", "rules",
        "prerequisites", "fallthrough", "offVariation", "key",
    ]);
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (handled.has(field)) continue;
        if (!deepEqual(a[field], b[field])) {
            if (lines.length === 0 || !lines[lines.length - 1].includes("─ Other")) {
                lines.push(sectionHeader("Other"));
            }
            lines.push(modified(`${field}: ${JSON.stringify(a[field])} → ${JSON.stringify(b[field])}`));
        }
    }

    if (lines.length === 0) lines.push("  No differences.");
    return lines;
}

function renderWholeFlag(flag: AnyObj, color: string, prefix: string): string[] {
    const lines: string[] = [];
    const cleaned = cleanItem(flag, FLAG_NOISE) as AnyObj;
    const vars = (cleaned.variations ?? []) as unknown[];

    lines.push(`  ${color}${prefix} on: ${cleaned.on}${R}`);

    if (vars.length) {
        lines.push(`  ${color}${prefix} variations:${R}`);
        for (let i = 0; i < vars.length; i++) {
            lines.push(`  ${color}${prefix}   [${i}] ${JSON.stringify(vars[i])}${R}`);
        }
    }

    const targets = (cleaned.targets ?? []) as AnyObj[];
    const ctxTargets = (cleaned.contextTargets ?? []) as AnyObj[];
    if (targets.length || ctxTargets.length) {
        lines.push(`  ${color}${prefix} targets:${R}`);
        for (const t of targets) {
            lines.push(`  ${color}${prefix}   ${fmtVariation(t.variation, vars)}: ${(t.values ?? []).join(", ")}${R}`);
        }
        for (const t of ctxTargets) {
            const ctx = t.contextKind ? `${t.contextKind}: ` : "";
            lines.push(`  ${color}${prefix}   ${ctx}${fmtVariation(t.variation, vars)}: ${(t.values ?? []).join(", ")}${R}`);
        }
    }

    const rules = (cleaned.rules ?? []) as AnyObj[];
    for (let i = 0; i < rules.length; i++) {
        lines.push(`  ${color}${prefix} Rule ${i + 1}:${R}`);
        for (const rl of renderRule(rules[i], vars, `  ${color}${prefix} `)) {
            lines.push(`${color}${rl}${R}`);
        }
    }

    if (cleaned.fallthrough) {
        lines.push(`  ${color}${prefix} fallthrough: ${fmtServe(cleaned.fallthrough, vars)}${R}`);
    }
    if (cleaned.offVariation !== undefined) {
        lines.push(`  ${color}${prefix} off variation: ${fmtVariation(cleaned.offVariation, vars)}${R}`);
    }

    return lines;
}

function renderTargetsDiff(lines: string[], a: AnyObj, b: AnyObj, vars: unknown[]): void {
    // Build maps: variation → Set<value> for each side, grouped by contextKind
    type TargetMap = Map<string, Set<string>>; // key = "kind:variation"

    function buildTargetMap(targets: AnyObj[], ctxTargets: AnyObj[]): TargetMap {
        const m: TargetMap = new Map();
        for (const t of targets) {
            const k = `user:${t.variation}`;
            if (!m.has(k)) m.set(k, new Set());
            for (const v of (t.values ?? [])) m.get(k)!.add(v);
        }
        for (const t of ctxTargets) {
            const ctx = t.contextKind ?? "user";
            const k = `${ctx}:${t.variation}`;
            if (!m.has(k)) m.set(k, new Set());
            for (const v of (t.values ?? [])) m.get(k)!.add(v);
        }
        return m;
    }

    const mapA = buildTargetMap(a.targets ?? [], a.contextTargets ?? []);
    const mapB = buildTargetMap(b.targets ?? [], b.contextTargets ?? []);
    const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

    for (const key of [...allKeys].sort()) {
        const [ctx, varIdx] = key.split(":");
        const label = ctx === "user"
            ? fmtVariation(Number(varIdx), vars)
            : `${ctx} → ${fmtVariation(Number(varIdx), vars)}`;
        const setA = mapA.get(key) ?? new Set();
        const setB = mapB.get(key) ?? new Set();

        if (deepEqual([...setA].sort(), [...setB].sort())) continue;

        lines.push(`    ${label}:`);
        for (const v of setA) {
            if (!setB.has(v)) lines.push(removed(`  ${v}`));
        }
        for (const v of setB) {
            if (!setA.has(v)) lines.push(added(`  ${v}`));
        }
    }
}

function renderRulesDiff(lines: string[], a: AnyObj, b: AnyObj, vars: unknown[]): void {
    const rulesA = (a.rules ?? []) as AnyObj[];
    const rulesB = (b.rules ?? []) as AnyObj[];
    const maxLen = Math.max(rulesA.length, rulesB.length);

    for (let i = 0; i < maxLen; i++) {
        const ra = rulesA[i];
        const rb = rulesB[i];

        if (!ra) {
            lines.push(added(`Rule ${i + 1}:`));
            for (const rl of renderRule(rb, vars, "    ")) lines.push(`  ${GREEN}${rl}${R}`);
            continue;
        }
        if (!rb) {
            lines.push(removed(`Rule ${i + 1}:`));
            for (const rl of renderRule(ra, vars, "    ")) lines.push(`  ${RED}${rl}${R}`);
            continue;
        }

        if (deepEqual(deepClean(ra), deepClean(rb))) continue;

        lines.push(modified(`Rule ${i + 1}:`));

        // Diff clauses
        const clausesA = (ra.clauses ?? []) as AnyObj[];
        const clausesB = (rb.clauses ?? []) as AnyObj[];
        const maxClauses = Math.max(clausesA.length, clausesB.length);
        for (let c = 0; c < maxClauses; c++) {
            const ca = clausesA[c];
            const cb = clausesB[c];
            const prefix = c === 0 ? "IF " : "AND ";
            if (!ca) {
                lines.push(added(`  ${prefix}${fmtClause(cb)}`));
            } else if (!cb) {
                lines.push(removed(`  ${prefix}${fmtClause(ca)}`));
            } else if (!deepEqual(deepClean(ca), deepClean(cb))) {
                lines.push(modified(`  ${prefix}${fmtClause(ca)} → ${fmtClause(cb)}`));
            } else {
                lines.push(unchanged(`${prefix}${fmtClause(ca)}`));
            }
        }

        // Diff serve
        const serveA = fmtServe(ra, vars);
        const serveB = fmtServe(rb, vars);
        if (serveA !== serveB) {
            lines.push(modified(`  SERVE ${serveA} → ${serveB}`));
        } else {
            lines.push(unchanged(`SERVE ${serveA}`));
        }
    }
}

function renderPrereqsDiff(lines: string[], a: AnyObj, b: AnyObj): void {
    const preA = (a.prerequisites ?? []) as AnyObj[];
    const preB = (b.prerequisites ?? []) as AnyObj[];
    const maxLen = Math.max(preA.length, preB.length);
    for (let i = 0; i < maxLen; i++) {
        const pa = preA[i];
        const pb = preB[i];
        const fmt = (p: AnyObj) => `${p.key} must be variation ${p.variation}`;
        if (!pa) lines.push(added(fmt(pb)));
        else if (!pb) lines.push(removed(fmt(pa)));
        else if (!deepEqual(pa, pb)) {
            lines.push(removed(fmt(pa)));
            lines.push(added(fmt(pb)));
        }
    }
}

// --- Segment detail renderer ---

function renderSegmentDetail(
    segA: AnyObj | undefined,
    segB: AnyObj | undefined,
): string[] {
    if (!segA && !segB) return ["  No data."];

    if (!segA) return renderWholeSegment(segB!, GREEN, "+");
    if (!segB) return renderWholeSegment(segA!, RED, "-");

    const a = cleanItem(segA, SEGMENT_NOISE) as AnyObj;
    const b = cleanItem(segB, SEGMENT_NOISE) as AnyObj;

    const lines: string[] = [];

    // Members: included, excluded, includedContexts, excludedContexts
    const memberFields = [
        { field: "included", label: "Included" },
        { field: "excluded", label: "Excluded" },
        { field: "includedContexts", label: "Included contexts" },
        { field: "excludedContexts", label: "Excluded contexts" },
    ];

    let hasMembers = false;
    for (const { field, label } of memberFields) {
        const arrA = (a[field] ?? []) as string[];
        const arrB = (b[field] ?? []) as string[];
        if (deepEqual(arrA, arrB)) continue;

        if (!hasMembers) {
            lines.push(sectionHeader("Members"));
            hasMembers = true;
        }
        lines.push(`    ${label}:`);

        const setA = new Set(arrA);
        const setB = new Set(arrB);
        for (const v of arrA) {
            if (!setB.has(v)) lines.push(removed(`  ${v}`));
        }
        for (const v of arrB) {
            if (!setA.has(v)) lines.push(added(`  ${v}`));
        }
    }
    if (hasMembers) lines.push("");

    // Rules
    if (!deepEqual(a.rules, b.rules)) {
        lines.push(sectionHeader("Rules"));
        const rulesA = (a.rules ?? []) as AnyObj[];
        const rulesB = (b.rules ?? []) as AnyObj[];
        const maxLen = Math.max(rulesA.length, rulesB.length);

        for (let i = 0; i < maxLen; i++) {
            const ra = rulesA[i];
            const rb = rulesB[i];

            if (!ra) {
                lines.push(added(`Rule ${i + 1}:`));
                renderSegmentRule(rb, "    ").forEach(l => lines.push(`  ${GREEN}${l}${R}`));
            } else if (!rb) {
                lines.push(removed(`Rule ${i + 1}:`));
                renderSegmentRule(ra, "    ").forEach(l => lines.push(`  ${RED}${l}${R}`));
            } else if (!deepEqual(deepClean(ra), deepClean(rb))) {
                lines.push(modified(`Rule ${i + 1}:`));
                // Show clause-by-clause diff
                const clausesA = (ra.clauses ?? []) as AnyObj[];
                const clausesB = (rb.clauses ?? []) as AnyObj[];
                const maxClauses = Math.max(clausesA.length, clausesB.length);
                for (let c = 0; c < maxClauses; c++) {
                    const ca = clausesA[c];
                    const cb = clausesB[c];
                    const prefix = c === 0 ? "IF " : "AND ";
                    if (!ca) lines.push(added(`  ${prefix}${fmtClause(cb)}`));
                    else if (!cb) lines.push(removed(`  ${prefix}${fmtClause(ca)}`));
                    else if (!deepEqual(deepClean(ca), deepClean(cb))) {
                        lines.push(modified(`  ${prefix}${fmtClause(ca)} → ${fmtClause(cb)}`));
                    } else {
                        lines.push(unchanged(`${prefix}${fmtClause(ca)}`));
                    }
                }
                // Weight
                if (ra.weight !== rb.weight) {
                    lines.push(modified(`  weight: ${ra.weight} → ${rb.weight}`));
                }
            }
        }
        lines.push("");
    }

    if (lines.length === 0) lines.push("  No differences.");
    return lines;
}

function renderSegmentRule(rule: AnyObj, indent: string): string[] {
    const lines: string[] = [];
    const clauses = (rule.clauses ?? []) as AnyObj[];
    for (let i = 0; i < clauses.length; i++) {
        const prefix = i === 0 ? "IF " : "AND ";
        lines.push(`${indent}${prefix}${fmtClause(clauses[i])}`);
    }
    if (rule.weight !== undefined) {
        lines.push(`${indent}weight: ${rule.weight}`);
    }
    return lines;
}

function renderWholeSegment(seg: AnyObj, color: string, prefix: string): string[] {
    const lines: string[] = [];
    const cleaned = cleanItem(seg, SEGMENT_NOISE) as AnyObj;

    for (const field of ["included", "excluded"]) {
        const arr = (cleaned[field] ?? []) as string[];
        if (arr.length) {
            lines.push(`  ${color}${prefix} ${field}: ${arr.join(", ")}${R}`);
        }
    }
    const rules = (cleaned.rules ?? []) as AnyObj[];
    for (let i = 0; i < rules.length; i++) {
        lines.push(`  ${color}${prefix} Rule ${i + 1}:${R}`);
        for (const rl of renderSegmentRule(rules[i], `  ${color}${prefix}   `)) {
            lines.push(`${color}${rl}${R}`);
        }
    }
    return lines;
}

// --- Detail lines entry point ---

/** Pretty-print a value as syntax-highlighted JSON lines. */
function colorJson(value: unknown, indent = 0): string[] {
    const pad = "  " + " ".repeat(indent * 2);
    const inner = "  " + " ".repeat((indent + 1) * 2);

    if (value === null) return [`${pad}${DIM}null${R}`];
    if (typeof value === "boolean") return [`${pad}${value ? GREEN : RED}${value}${R}`];
    if (typeof value === "number") return [`${pad}${YELLOW}${value}${R}`];
    if (typeof value === "string") return [`${pad}${GREEN}"${value}"${R}`];

    if (Array.isArray(value)) {
        if (value.length === 0) return [`${pad}[]`];
        // Compact arrays of primitives on one line
        if (value.every(v => v === null || typeof v !== "object")) {
            const items = value.map(v => {
                if (v === null) return `${DIM}null${R}`;
                if (typeof v === "boolean") return `${v ? GREEN : RED}${v}${R}`;
                if (typeof v === "number") return `${YELLOW}${v}${R}`;
                return `${GREEN}"${v}"${R}`;
            });
            return [`${pad}[${items.join(", ")}]`];
        }
        const lines = [`${pad}[`];
        for (let i = 0; i < value.length; i++) {
            const child = colorJson(value[i], indent + 1);
            const last = i === value.length - 1;
            child[child.length - 1] += last ? "" : ",";
            lines.push(...child);
        }
        lines.push(`${pad}]`);
        return lines;
    }

    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return [`${pad}{}`];
        const lines = [`${pad}{`];
        for (let i = 0; i < entries.length; i++) {
            const [k, v] = entries[i];
            const last = i === entries.length - 1;
            const comma = last ? "" : ",";
            // Simple values: key and value on same line
            if (v === null || typeof v !== "object") {
                const vStr = v === null ? `${DIM}null${R}`
                    : typeof v === "boolean" ? `${v ? GREEN : RED}${v}${R}`
                    : typeof v === "number" ? `${YELLOW}${v}${R}`
                    : `${GREEN}"${v}"${R}`;
                lines.push(`${inner}${BOLD}\x1b[36m"${k}"${R}: ${vStr}${comma}`);
            } else {
                lines.push(`${inner}${BOLD}\x1b[36m"${k}"${R}:`);
                const child = colorJson(v, indent + 1);
                child[child.length - 1] += comma;
                lines.push(...child);
            }
        }
        lines.push(`${pad}}`);
        return lines;
    }

    return [`${pad}${String(value)}`];
}

function getDetailLines(
    kind: "flag" | "segment",
    key: string,
    storeA: CaptureStore,
    storeB: CaptureStore,
    format: DetailFormat,
): string[] {
    const payloadA = storeA.toPayload();
    const payloadB = storeB.toPayload();

    const section = kind === "flag" ? "flags" : "segments";
    const itemA = (payloadA[section] as Record<string, unknown>)?.[key] as AnyObj | undefined;
    const itemB = (payloadB[section] as Record<string, unknown>)?.[key] as AnyObj | undefined;

    if (format === "ui") {
        return kind === "flag"
            ? renderFlagDetail(itemA, itemB)
            : renderSegmentDetail(itemA, itemB);
    }

    // jsondiffpatch-based formats: clean then diff
    const noiseFields = kind === "flag" ? FLAG_NOISE : SEGMENT_NOISE;
    const cleanA = itemA ? cleanItem(itemA, noiseFields) : {};
    const cleanB = itemB ? cleanItem(itemB, noiseFields) : {};
    const delta = differ.diff(cleanA, cleanB) as Record<string, unknown> | undefined;

    if (!delta) return ["  No differences."];

    if (format === "console") {
        const out = consoleFormat(delta as never);
        return out ? out.split("\n") : ["  No differences."];
    }
    if (format === "json-patch") {
        const ops = jsonpatchFormat(delta as never);
        return colorJson(ops);
    }
    // delta
    return colorJson(delta);
}

// --- Debounce helper ---

function debounce(fn: () => void, ms: number): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(fn, ms);
    };
}

// --- TUI rendering ---

type DetailFormat = "ui" | "console" | "json-patch" | "delta";
const DETAIL_FORMATS: DetailFormat[] = ["ui", "console", "json-patch", "delta"];

type ConnectionStatus = "connecting" | "connected" | "failed" | "error";

interface TUIState {
    statusA: ConnectionStatus;
    statusB: ConnectionStatus;
    cursor: number;
    scrollOffset: number;
    analysis: AnalysisResult;
    detailItem: { kind: "flag" | "segment"; key: string } | null;
    detailFormat: DetailFormat;
    detailLines: string[];
    lastUpdate: Date | null;
}

const HEADER_LINES = 4;
const FOOTER_LINES = 2;

function statusColor(s: ConnectionStatus): string {
    switch (s) {
        case "connected": return "\x1b[32m";
        case "connecting": return "\x1b[33m";
        case "failed":
        case "error": return "\x1b[31m";
    }
}

function fmtColumnChanges(c: ColumnChanges): string {
    if (!hasChanges(c)) return "";
    const parts: string[] = [];
    if (c.added > 0) parts.push(`${GREEN}+${c.added}${R}`);
    if (c.removed > 0) parts.push(`${RED}-${c.removed}${R}`);
    if (c.modified > 0) parts.push(`${YELLOW}~${c.modified}${R}`);
    return parts.join(" ");
}

function padCell(formatted: string, width: number): string {
    const visible = formatted.replace(/\x1b\[[0-9;]*m/g, "");
    if (visible.length >= width) return formatted;
    return formatted + " ".repeat(width - visible.length);
}

function stripAnsi(s: string): string {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function buildListLines(
    analysis: AnalysisResult,
): { lines: string[]; rowMap: Map<number, { kind: "flag" | "segment"; key: string }> } {
    const lines: string[] = [];
    const rowMap = new Map<number, { kind: "flag" | "segment"; key: string }>();

    const COL = 12;
    const nameCol = 30;

    if (analysis.flags.length > 0) {
        const changed = analysis.flags.filter(f => f.status === "changed").length;
        const onlyA = analysis.flags.filter(f => f.status === "only-left").length;
        const onlyB = analysis.flags.filter(f => f.status === "only-right").length;
        lines.push(`${BOLD}  FLAGS${R}  ${changed} changed, ${onlyA} only A, ${onlyB} only B`);

        lines.push(
            `    ${"Name".padEnd(nameCol - 4)}${"Targets".padEnd(COL)}${"Rules".padEnd(COL)}${"Defaults".padEnd(COL)}${"Variations".padEnd(COL)}`,
        );

        for (const flag of analysis.flags) {
            const idx = lines.length;
            const prefix = flag.status === "only-left"
                ? `${RED}-${R}`
                : flag.status === "only-right"
                ? `${GREEN}+${R}`
                : " ";
            const name = flag.key.length > nameCol - 4
                ? flag.key.slice(0, nameCol - 7) + "..."
                : flag.key.padEnd(nameCol - 4);
            if (flag.status === "changed") {
                lines.push(
                    `  ${prefix} ${name}${padCell(fmtColumnChanges(flag.targets), COL)}${padCell(fmtColumnChanges(flag.rules), COL)}${padCell(fmtColumnChanges(flag.defaults), COL)}${padCell(fmtColumnChanges(flag.variations), COL)}`,
                );
            } else {
                lines.push(`  ${prefix} ${name}`);
            }
            rowMap.set(idx, { kind: "flag", key: flag.key });
        }
    }

    if (analysis.segments.length > 0) {
        lines.push("");
        const changed = analysis.segments.filter(s => s.status === "changed").length;
        const onlyA = analysis.segments.filter(s => s.status === "only-left").length;
        const onlyB = analysis.segments.filter(s => s.status === "only-right").length;
        lines.push(`${BOLD}  SEGMENTS${R}  ${changed} changed, ${onlyA} only A, ${onlyB} only B`);

        lines.push(
            `    ${"Name".padEnd(nameCol - 4)}${"Members".padEnd(COL)}${"Rules".padEnd(COL)}`,
        );

        for (const seg of analysis.segments) {
            const idx = lines.length;
            const prefix = seg.status === "only-left"
                ? `${RED}-${R}`
                : seg.status === "only-right"
                ? `${GREEN}+${R}`
                : " ";
            const name = seg.key.length > nameCol - 4
                ? seg.key.slice(0, nameCol - 7) + "..."
                : seg.key.padEnd(nameCol - 4);
            if (seg.status === "changed") {
                lines.push(
                    `  ${prefix} ${name}${padCell(fmtColumnChanges(seg.members), COL)}${padCell(fmtColumnChanges(seg.rules), COL)}`,
                );
            } else {
                lines.push(`  ${prefix} ${name}`);
            }
            rowMap.set(idx, { kind: "segment", key: seg.key });
        }
    }

    if (lines.length === 0) {
        lines.push("  No differences.");
    }

    return { lines, rowMap };
}

function render(state: TUIState, storeA: CaptureStore, storeB: CaptureStore): void {
    const { columns, rows } = Deno.consoleSize();
    let output = "\x1b[2J\x1b[H";

    const timeStr = state.lastUpdate?.toLocaleTimeString() ?? "--:--:--";
    if (state.detailItem) {
        output += `${BOLD}  live diff${R}  ${timeStr}  \x1b[36m▸ ${state.detailItem.key}${R}\n`;
    } else {
        output += `${BOLD}  live diff${R}  ${timeStr}\n`;
    }
    output += `  A: ${statusColor(state.statusA)}${state.statusA}${R}  `;
    output += `B: ${statusColor(state.statusB)}${state.statusB}${R}\n`;
    output += "─".repeat(columns) + "\n";

    const bodyHeight = rows - HEADER_LINES - FOOTER_LINES;

    if (state.detailItem) {
        const totalLines = state.detailLines.length;
        const maxOffset = Math.max(0, totalLines - bodyHeight);
        state.scrollOffset = Math.min(state.scrollOffset, maxOffset);
        state.scrollOffset = Math.max(0, state.scrollOffset);

        const visible = state.detailLines.slice(state.scrollOffset, state.scrollOffset + bodyHeight);
        for (const line of visible) output += line + "\n";
        for (let i = visible.length; i < bodyHeight; i++) output += "\n";

        output += "─".repeat(columns) + "\n";
        const pct = totalLines > 0
            ? Math.min(100, Math.round(((state.scrollOffset + bodyHeight) / totalLines) * 100))
            : 100;
        const scrollInfo = totalLines > bodyHeight ? `${pct}%` : "all";
        output += `  ←/esc back  ↑/↓ scroll  f format  q quit  [${state.detailFormat}] [${scrollInfo}]`;
    } else {
        const { lines, rowMap } = buildListLines(state.analysis);
        const selectableIndices = [...rowMap.keys()].sort((a, b) => a - b);
        if (selectableIndices.length > 0) {
            state.cursor = Math.max(0, Math.min(state.cursor, selectableIndices.length - 1));
        }

        const selectedLineIdx = selectableIndices[state.cursor] ?? -1;

        if (selectedLineIdx >= 0) {
            if (selectedLineIdx < state.scrollOffset) state.scrollOffset = selectedLineIdx;
            if (selectedLineIdx >= state.scrollOffset + bodyHeight) {
                state.scrollOffset = selectedLineIdx - bodyHeight + 1;
            }
        }
        const maxOffset = Math.max(0, lines.length - bodyHeight);
        state.scrollOffset = Math.min(state.scrollOffset, maxOffset);
        state.scrollOffset = Math.max(0, state.scrollOffset);

        const visible = lines.slice(state.scrollOffset, state.scrollOffset + bodyHeight);
        for (let i = 0; i < bodyHeight; i++) {
            const globalIdx = state.scrollOffset + i;
            const line = visible[i] ?? "";
            if (globalIdx === selectedLineIdx) {
                output += `\x1b[7m${line}${" ".repeat(Math.max(0, columns - stripAnsi(line).length))}${R}\n`;
            } else {
                output += line + "\n";
            }
        }

        output += "─".repeat(columns) + "\n";
        output += `  ↑/↓ select  enter detail  q quit`;
    }

    Deno.stdout.writeSync(new TextEncoder().encode(output));
}

// --- Orchestrator ---

export async function startLiveMode(opts: LiveModeOptions): Promise<void> {
    // deno-lint-ignore no-explicit-any
    const ld = await import("npm:@launchdarkly/node-server-sdk@9") as any;

    const state: TUIState = {
        statusA: "connecting",
        statusB: "connecting",
        cursor: 0,
        scrollOffset: 0,
        analysis: { flags: [], segments: [] },
        detailItem: null,
        detailFormat: "ui",
        detailLines: [],
        lastUpdate: null,
    };

    let storeA: CaptureStore;
    let storeB: CaptureStore;

    function recompute() {
        try {
            const payloadA = storeA.toPayload();
            const payloadB = storeB.toPayload();
            state.analysis = analyzePayloads(payloadA, payloadB, opts.includeSegments);
            state.lastUpdate = new Date();

            if (state.detailItem) {
                state.detailLines = getDetailLines(
                    state.detailItem.kind, state.detailItem.key,
                    storeA, storeB, state.detailFormat,
                );
            }
        } catch {
            // stores not ready yet
        }
        render(state, storeA, storeB);
    }

    const debouncedRecompute = debounce(recompute, 200);

    storeA = new CaptureStore(debouncedRecompute);
    storeB = new CaptureStore(debouncedRecompute);

    // deno-lint-ignore no-explicit-any
    const sdkOpts: Record<string, any> = {
        sendEvents: false,
        logger: ld.basicLogger({ level: "warn" }),
    };
    if (opts.streamUrl) {
        sdkOpts.streamUri = opts.streamUrl;
    }

    const clientA = ld.init(opts.sdkKeyA, { ...sdkOpts, featureStore: storeA });
    const clientB = ld.init(opts.sdkKeyB, { ...sdkOpts, featureStore: storeB });

    clientA.on("ready", () => { state.statusA = "connected"; render(state, storeA, storeB); });
    clientA.on("failed", () => { state.statusA = "failed"; render(state, storeA, storeB); });
    clientA.on("error", () => { if (state.statusA !== "connected") state.statusA = "error"; render(state, storeA, storeB); });

    clientB.on("ready", () => { state.statusB = "connected"; render(state, storeA, storeB); });
    clientB.on("failed", () => { state.statusB = "failed"; render(state, storeA, storeB); });
    clientB.on("error", () => { if (state.statusB !== "connected") state.statusB = "error"; render(state, storeA, storeB); });

    render(state, storeA, storeB);

    await Promise.allSettled([
        clientA.waitForInitialization({ timeout: 30 }),
        clientB.waitForInitialization({ timeout: 30 }),
    ]);

    Deno.stdin.setRaw(true);
    const buf = new Uint8Array(16);

    try {
        while (true) {
            const n = await Deno.stdin.read(buf);
            if (n === null) break;
            const input = buf.subarray(0, n);

            if (input[0] === 0x71 || input[0] === 0x03) break;

            if (input[0] === 0x1b && input.length === 1) {
                if (state.detailItem) {
                    state.detailItem = null;
                    state.detailLines = [];
                    state.scrollOffset = 0;
                    render(state, storeA, storeB);
                }
                continue;
            }

            if (input.length >= 3 && input[0] === 0x1b && input[1] === 0x5b) {
                if (input[2] === 0x44 && state.detailItem) { // Left arrow — back
                    state.detailItem = null;
                    state.detailLines = [];
                    state.scrollOffset = 0;
                    render(state, storeA, storeB);
                } else if (input[2] === 0x41) { // Up
                    if (state.detailItem) state.scrollOffset = Math.max(0, state.scrollOffset - 1);
                    else state.cursor = Math.max(0, state.cursor - 1);
                    render(state, storeA, storeB);
                } else if (input[2] === 0x42) { // Down
                    if (state.detailItem) state.scrollOffset++;
                    else state.cursor++;
                    render(state, storeA, storeB);
                }
                continue;
            }

            if (input[0] === 0x6b) {
                if (state.detailItem) state.scrollOffset = Math.max(0, state.scrollOffset - 1);
                else state.cursor = Math.max(0, state.cursor - 1);
                render(state, storeA, storeB);
            } else if (input[0] === 0x6a) {
                if (state.detailItem) state.scrollOffset++;
                else state.cursor++;
                render(state, storeA, storeB);
            }

            if (input[0] === 0x0d) {
                if (!state.detailItem) {
                    const { rowMap } = buildListLines(state.analysis);
                    const selectableIndices = [...rowMap.keys()].sort((a, b) => a - b);
                    const selectedLineIdx = selectableIndices[state.cursor];
                    const item = selectedLineIdx !== undefined ? rowMap.get(selectedLineIdx) : undefined;
                    if (item) {
                        state.detailItem = item;
                        state.detailFormat = "ui";
                        state.scrollOffset = 0;
                        state.detailLines = getDetailLines(
                            item.kind, item.key, storeA, storeB, state.detailFormat,
                        );
                        render(state, storeA, storeB);
                    }
                }
                continue;
            }

            // f — cycle detail format
            if (input[0] === 0x66 && state.detailItem) {
                const idx = DETAIL_FORMATS.indexOf(state.detailFormat);
                state.detailFormat = DETAIL_FORMATS[(idx + 1) % DETAIL_FORMATS.length];
                state.scrollOffset = 0;
                state.detailLines = getDetailLines(
                    state.detailItem.kind, state.detailItem.key,
                    storeA, storeB, state.detailFormat,
                );
                render(state, storeA, storeB);
                continue;
            }

            if (input[0] === 0x7f || input[0] === 0x08) {
                if (state.detailItem) {
                    state.detailItem = null;
                    state.detailLines = [];
                    state.scrollOffset = 0;
                    render(state, storeA, storeB);
                }
            }
        }
    } finally {
        Deno.stdin.setRaw(false);
        Deno.stdout.writeSync(new TextEncoder().encode("\x1b[2J\x1b[H"));
        await clientA.close();
        await clientB.close();
    }

    Deno.exit(0);
}
