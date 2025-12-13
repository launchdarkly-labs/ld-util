#!/usr/bin/env -S deno run --allow-net --allow-env

import { parseArgs } from "jsr:@std/cli/parse-args";
import { getAllFlags } from "../get-all-flags/get-all-flags.ts";
import { getAllFlagStatuses } from "../get-all-flag-statuses/get-all-flag-statuses.ts";

interface Flag {
    key: string;
    name?: string;
    tags?: string[];
    defaults?: {
        onVariation?: number;
        offVariation?: number;
    };
    prerequisites?: Array<{
        key: string;
        variation: number;
    }>;
    environments: Record<string, {
        on: boolean;
        fallthrough?: number | null | {
            variations?: Array<{
                variation: number;
                weight: number;
            }>;
        };
        offVariation?: number | null;
        prerequisites?: Array<{
            key: string;
            variation: number;
        }>;
        rules?: Array<{
            variation?: number;
            rollout?: {
                variations: Array<{
                    variation: number;
                    weight: number;
                }>;
            };
        }>;
        targets?: Array<{
            variation: number;
            values?: string[];
        }>;
        contextTargets?: Array<{
            variation: number;
            values?: string[];
            contextKind?: string;
        }>;
        _summary?: {
            prerequisites?: number;
            variations?: Record<string, {
                isFallthrough?: boolean;
                isOff?: boolean;
                rules?: number;
                targets?: number;
                contextTargets?: number;
            }>;
        };
    }>;
    variations: Array<{
        value: unknown;
        name?: string;
        description?: string;
    }>;
}

interface FlagStatus {
    default?: unknown;
    _links: {
        parent: {
            href: string;
        };
    };
}

interface ImpactedUser {
    type: "target" | "contextTarget" | "rule" | "fallthrough";
    variation: number;
    values?: string[];
    contextKind?: string;
    ruleIndex?: number;
    weight?: number;
}

interface VariationServing {
    variation: number;
    variationValue?: unknown;
    targets?: Array<{ values?: string[] }>;
    contextTargets?: Array<{ values?: string[]; contextKind?: string }>;
    rules?: Array<{ ruleIndex: number; weight?: number }>;
    fallthrough?: { weight?: number };
}

interface Issue {
    flagKey: string;
    flagName?: string;
    tags?: string[];
    severity: "critical" | "warning" | "unknown";
    reason: string;
    fallbackValue: unknown;
    expectedValue?: unknown;
    recommendedFallback?: unknown | unknown[];
    recommendedFallbackExplanation?: string;
    impacted?: ImpactedUser[];
    variationServing?: VariationServing[];
    fallthrough?: { variation: number; variationValue: unknown; isRollout?: boolean; rolloutVariations?: Array<{ variation: number; variationValue: unknown; weight: number }> };
    offVariation?: { variation: number; variationValue: unknown };
    environmentOn: boolean;
}

function extractFlagKeyFromHref(href: string): string | null {
    const match = href.match(/\/api\/v2\/flags\/[^/]+\/(.+)$/);
    return match ? match[1] : null;
}

function getVariationDisplayName(
    flag: Flag,
    variationIndex: number,
): string {
    if (variationIndex < 0 || variationIndex >= flag.variations.length) {
        return `Variation ${variationIndex}`;
    }
    const variation = flag.variations[variationIndex];
    const valueStr = JSON.stringify(variation.value);
    if (variation.name) {
        return `${variation.name} (\`${valueStr}\`)`;
    }
    return `Variation ${variationIndex} (\`${valueStr}\`)`;
}

function getVariationValue(
    flag: Flag,
    variationIndex: number,
): unknown {
    if (variationIndex < 0 || variationIndex >= flag.variations.length) {
        return undefined;
    }
    return flag.variations[variationIndex].value;
}

function isRollout(fallthrough: number | { variation?: number; variations?: Array<{ variation: number; weight: number }> } | null | undefined): boolean {
    return typeof fallthrough === "object" && fallthrough !== null && 
        Array.isArray(fallthrough.variations);
}

// Helper to get variation from fallthrough (handles both number and object formats)
function getFallthroughVariation(fallthrough: number | { variation?: number; variations?: Array<{ variation: number; weight: number }> } | null | undefined): number | null {
    if (fallthrough === null || fallthrough === undefined) {
        return null;
    }
    if (typeof fallthrough === "number") {
        return fallthrough;
    }
    if (fallthrough.variation !== undefined) {
        return fallthrough.variation;
    }
    return null;
}

function getSingleVariationFromFallthrough(
    flag: Flag,
    environmentKey: string,
): number | null {
    const env = flag.environments[environmentKey];
    if (!env) return null;

    const fallthrough = env.fallthrough;
    
    // If fallthrough is null/undefined, check _summary for fallthrough variation
    if (fallthrough === null || fallthrough === undefined) {
        if (env._summary?.variations) {
            for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
                if (varInfo.isFallthrough && (varInfo.rules === 0 || varInfo.rules === undefined)) {
                    return parseInt(varIndex);
                }
            }
        }
        return null;
    }

    // If it's a rollout, check if it's 100% to one variation
    if (isRollout(fallthrough)) {
        const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
        const variations = rollout.variations;
        if (variations.length === 1) {
            return variations[0].variation;
        }
        // Check if all weight goes to one variation
        const totalWeight = variations.reduce((sum: number, v: { variation: number; weight: number }) => sum + v.weight, 0);
        if (totalWeight === 100000) {
            const singleVariation = variations.find((v: { variation: number; weight: number }) => v.weight === 100000);
            if (singleVariation) {
                return singleVariation.variation;
            }
        }
        return null; // Multiple variations in rollout
    }

    // If it's a simple variation index (number or object with variation property)
    const fallthroughVariation = getFallthroughVariation(fallthrough);
    if (fallthroughVariation !== null) {
        return fallthroughVariation;
    }

    return null;
}

function getOffVariation(
    flag: Flag,
    environmentKey: string,
): number | null {
    const env = flag.environments[environmentKey];
    if (!env) return null;

    const offVariation = env.offVariation;
    if (offVariation !== null && offVariation !== undefined) {
        return offVariation;
    }

    // Check _summary for off variation
    if (env._summary?.variations) {
        for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
            if (varInfo.isOff) {
                return parseInt(varIndex);
            }
        }
    }

    return null;
}

function checkFlagOnlyServesOneVariation(
    flag: Flag,
    environmentKey: string,
): boolean {
    const env = flag.environments[environmentKey];
    if (!env) return false;

    const servedVariations = new Set<number>();

    // Get fallthrough variation (or variations if it's a rollout)
    const fallthrough = env.fallthrough;
    if (fallthrough !== null && fallthrough !== undefined) {
        if (isRollout(fallthrough)) {
            // For rollouts, check if it's 100% to one variation
            const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
            const variations = rollout.variations;
            const totalWeight = variations.reduce((sum: number, v: { variation: number; weight: number }) => sum + v.weight, 0);
            if (totalWeight === 100000) {
                const singleVariation = variations.find((v: { variation: number; weight: number }) => v.weight === 100000);
                if (singleVariation) {
                    servedVariations.add(singleVariation.variation);
                }
            } else {
                // Multiple variations in rollout - not serving one variation
                return false;
            }
        } else {
            const fallthroughVariation = getFallthroughVariation(fallthrough);
            if (fallthroughVariation !== null) {
                servedVariations.add(fallthroughVariation);
            }
        }
    } else {
        // Fallthrough is null/undefined, check _summary for fallthrough variation
        if (env._summary?.variations) {
            for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
                if (varInfo.isFallthrough) {
                    servedVariations.add(parseInt(varIndex));
                    break;
                }
            }
        }
    }

    // Collect variations from rules, targets, and contextTargets
    if (env._summary?.variations) {
        for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
            const variationNum = parseInt(varIndex);
            
            // Add variation if it has rules, targets, or contextTargets
            if ((varInfo.rules !== undefined && varInfo.rules > 0) ||
                (varInfo.targets !== undefined && varInfo.targets > 0) ||
                (varInfo.contextTargets !== undefined && varInfo.contextTargets > 0)) {
                servedVariations.add(variationNum);
            }
        }
    }

    // Also check actual rules, targets, and contextTargets arrays if available
    // (these might be in the flag structure when expanded)
    if (Array.isArray(env.rules)) {
        for (const rule of env.rules) {
            if (rule.variation !== undefined && rule.variation !== null) {
                servedVariations.add(rule.variation);
            } else if (rule.rollout?.variations) {
                // Rule has a rollout - check if it's 100% to one variation
                const rolloutVariations = rule.rollout.variations;
                const totalWeight = rolloutVariations.reduce((sum: number, v: { variation: number; weight: number }) => sum + (v.weight || 0), 0);
                if (totalWeight === 100000) {
                    const singleVariation = rolloutVariations.find((v: { variation: number; weight: number }) => v.weight === 100000);
                    if (singleVariation) {
                        servedVariations.add(singleVariation.variation);
                    }
                } else {
                    // Multiple variations in rule rollout - not serving one variation
                    return false;
                }
            }
        }
    }

    if (Array.isArray(env.targets)) {
        for (const target of env.targets) {
            if (target.variation !== undefined && target.variation !== null) {
                servedVariations.add(target.variation);
            }
        }
    }

    if (Array.isArray(env.contextTargets)) {
        for (const target of env.contextTargets) {
            if (target.variation !== undefined && target.variation !== null) {
                servedVariations.add(target.variation);
            }
        }
    }

    // If all rules, rollouts (100%), fallthrough, and targets serve the same variation
    return servedVariations.size === 1;
}

function getAllVariationsServed(
    flag: Flag,
    environmentKey: string,
): Set<number> {
    const servedVariations = new Set<number>();
    const env = flag.environments[environmentKey];
    if (!env) return servedVariations;

    const fallthrough = env.fallthrough;
    if (fallthrough !== null && fallthrough !== undefined) {
        if (isRollout(fallthrough)) {
            const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
            for (const v of rollout.variations) {
                servedVariations.add(v.variation);
            }
        } else {
            const fallthroughVariation = getFallthroughVariation(fallthrough);
            if (fallthroughVariation !== null) {
                servedVariations.add(fallthroughVariation);
            }
        }
    } else if (env._summary?.variations) {
        for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
            if (varInfo.isFallthrough) {
                servedVariations.add(parseInt(varIndex));
                break;
            }
        }
    }

    if (Array.isArray(env.rules)) {
        for (const rule of env.rules) {
            if (rule.variation !== undefined && rule.variation !== null) {
                servedVariations.add(rule.variation);
            } else if (rule.rollout?.variations) {
                for (const v of rule.rollout.variations) {
                    servedVariations.add(v.variation);
                }
            }
        }
    }

    if (Array.isArray(env.targets)) {
        for (const target of env.targets) {
            if (target.variation !== undefined && target.variation !== null) {
                servedVariations.add(target.variation);
            }
        }
    }

    if (Array.isArray(env.contextTargets)) {
        for (const target of env.contextTargets) {
            if (target.variation !== undefined && target.variation !== null) {
                servedVariations.add(target.variation);
            }
        }
    }

    return servedVariations;
}

function getImpactedUsers(
    flag: Flag,
    environmentKey: string,
    incorrectVariation: number,
): ImpactedUser[] {
    const env = flag.environments[environmentKey];
    if (!env) return [];

    const impacted: ImpactedUser[] = [];

    // Check targets
    if (Array.isArray(env.targets)) {
        for (const target of env.targets) {
            if (target.variation === incorrectVariation) {
                impacted.push({
                    type: "target",
                    variation: target.variation,
                    values: target.values,
                });
            }
        }
    }

    // Check context targets
    if (Array.isArray(env.contextTargets)) {
        for (const target of env.contextTargets) {
            if (target.variation === incorrectVariation) {
                impacted.push({
                    type: "contextTarget",
                    variation: target.variation,
                    values: target.values,
                    contextKind: target.contextKind,
                });
            }
        }
    }

    // Check rules
    if (Array.isArray(env.rules)) {
        for (let i = 0; i < env.rules.length; i++) {
            const rule = env.rules[i];
            if (rule.variation === incorrectVariation) {
                impacted.push({
                    type: "rule",
                    variation: rule.variation,
                    ruleIndex: i,
                });
            } else if (rule.rollout?.variations) {
                const matchingVariation = rule.rollout.variations.find(
                    v => v.variation === incorrectVariation && v.weight > 0
                );
                if (matchingVariation) {
                    impacted.push({
                        type: "rule",
                        variation: incorrectVariation,
                        ruleIndex: i,
                        weight: matchingVariation.weight,
                    });
                }
            }
        }
    }

    // Check fallthrough
    const fallthrough = env.fallthrough;
    if (fallthrough !== null && fallthrough !== undefined) {
        const fallthroughVariation = getFallthroughVariation(fallthrough);
        if (fallthroughVariation !== null && fallthroughVariation === incorrectVariation) {
            impacted.push({
                type: "fallthrough",
                variation: fallthroughVariation,
            });
        } else if (isRollout(fallthrough)) {
            const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
            const matchingVariation = rollout.variations.find(
                v => v.variation === incorrectVariation && v.weight > 0
            );
            if (matchingVariation) {
                impacted.push({
                    type: "fallthrough",
                    variation: incorrectVariation,
                    weight: matchingVariation.weight,
                });
            }
        }
    }

    return impacted;
}

function getVariationServing(
    flag: Flag,
    environmentKey: string,
): VariationServing[] {
    const env = flag.environments[environmentKey];
    if (!env) return [];

    const servingMap = new Map<number, VariationServing>();

    // Process targets
    if (Array.isArray(env.targets)) {
        for (const target of env.targets) {
            if (target.variation !== undefined && target.variation !== null) {
                if (!servingMap.has(target.variation)) {
                    servingMap.set(target.variation, { 
                        variation: target.variation,
                        variationValue: getVariationValue(flag, target.variation),
                    });
                }
                const serving = servingMap.get(target.variation)!;
                if (!serving.targets) {
                    serving.targets = [];
                }
                serving.targets.push({ values: target.values });
            }
        }
    }

    // Process context targets
    if (Array.isArray(env.contextTargets)) {
        for (const target of env.contextTargets) {
            if (target.variation !== undefined && target.variation !== null) {
                if (!servingMap.has(target.variation)) {
                    servingMap.set(target.variation, { 
                        variation: target.variation,
                        variationValue: getVariationValue(flag, target.variation),
                    });
                }
                const serving = servingMap.get(target.variation)!;
                if (!serving.contextTargets) {
                    serving.contextTargets = [];
                }
                serving.contextTargets.push({
                    values: target.values,
                    contextKind: target.contextKind,
                });
            }
        }
    }

    // Process rules
    if (Array.isArray(env.rules)) {
        for (let i = 0; i < env.rules.length; i++) {
            const rule = env.rules[i];
            if (rule.variation !== undefined && rule.variation !== null) {
                if (!servingMap.has(rule.variation)) {
                    servingMap.set(rule.variation, { 
                        variation: rule.variation,
                        variationValue: getVariationValue(flag, rule.variation),
                    });
                }
                const serving = servingMap.get(rule.variation)!;
                if (!serving.rules) {
                    serving.rules = [];
                }
                serving.rules.push({ ruleIndex: i });
            } else if (rule.rollout?.variations) {
                for (const rolloutVar of rule.rollout.variations) {
                    if (rolloutVar.weight > 0) {
                        if (!servingMap.has(rolloutVar.variation)) {
                            servingMap.set(rolloutVar.variation, { 
                                variation: rolloutVar.variation,
                                variationValue: getVariationValue(flag, rolloutVar.variation),
                            });
                        }
                        const serving = servingMap.get(rolloutVar.variation)!;
                        if (!serving.rules) {
                            serving.rules = [];
                        }
                        serving.rules.push({
                            ruleIndex: i,
                            weight: rolloutVar.weight,
                        });
                    }
                }
            }
        }
    }

    // Process fallthrough
    const fallthrough = env.fallthrough;
    if (fallthrough !== null && fallthrough !== undefined) {
        const fallthroughVariation = getFallthroughVariation(fallthrough);
        if (fallthroughVariation !== null) {
            if (!servingMap.has(fallthroughVariation)) {
                servingMap.set(fallthroughVariation, { 
                    variation: fallthroughVariation,
                    variationValue: getVariationValue(flag, fallthroughVariation),
                });
            }
            const serving = servingMap.get(fallthroughVariation)!;
            serving.fallthrough = {};
        } else if (isRollout(fallthrough)) {
            const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
            for (const rolloutVar of rollout.variations) {
                if (rolloutVar.weight > 0) {
                    if (!servingMap.has(rolloutVar.variation)) {
                        servingMap.set(rolloutVar.variation, { 
                            variation: rolloutVar.variation,
                            variationValue: getVariationValue(flag, rolloutVar.variation),
                        });
                    }
                    const serving = servingMap.get(rolloutVar.variation)!;
                    serving.fallthrough = { weight: rolloutVar.weight };
                }
            }
        }
    } else if (env._summary?.variations) {
        // Fallthrough is null/undefined, check _summary for fallthrough variation
        for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
            if (varInfo.isFallthrough) {
                const variationNum = parseInt(varIndex);
                if (!servingMap.has(variationNum)) {
                    servingMap.set(variationNum, { 
                        variation: variationNum,
                        variationValue: getVariationValue(flag, variationNum),
                    });
                }
                const serving = servingMap.get(variationNum)!;
                serving.fallthrough = {};
                break; // Only one fallthrough variation
            }
        }
    }

    // Also check _summary for variations served by rules/targets that might not be in the detailed arrays
    if (env._summary?.variations) {
        for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
            const variationNum = parseInt(varIndex);
            // Skip if already processed (fallthrough) or if it's just the off variation with no rules/targets
            if (servingMap.has(variationNum)) {
                continue;
            }
            
            // Include variation if it's served by rules, targets, or contextTargets
            if ((varInfo.rules && varInfo.rules > 0) || 
                (varInfo.targets && varInfo.targets > 0) || 
                (varInfo.contextTargets && varInfo.contextTargets > 0)) {
                const serving: VariationServing = { 
                    variation: variationNum,
                    variationValue: getVariationValue(flag, variationNum),
                };
                
                // Add placeholder info from _summary since detailed arrays aren't available
                if (varInfo.rules && varInfo.rules > 0 && (!Array.isArray(env.rules) || env.rules.length === 0)) {
                    // Create placeholder rules entries (we don't know the exact rule indices)
                    serving.rules = [];
                    for (let i = 0; i < varInfo.rules; i++) {
                        serving.rules.push({ ruleIndex: -1 }); // -1 indicates unknown rule index
                    }
                }
                if (varInfo.targets && varInfo.targets > 0 && (!Array.isArray(env.targets) || env.targets.length === 0)) {
                    serving.targets = [{ values: undefined }]; // Placeholder
                }
                if (varInfo.contextTargets && varInfo.contextTargets > 0 && (!Array.isArray(env.contextTargets) || env.contextTargets.length === 0)) {
                    serving.contextTargets = [{ values: undefined }]; // Placeholder
                }
                
                servingMap.set(variationNum, serving);
            }
        }
    }

    return Array.from(servingMap.values()).sort((a, b) => a.variation - b.variation);
}

function getFallthroughInfo(
    flag: Flag,
    environmentKey: string,
): { variation: number; variationValue: unknown; isRollout?: boolean; rolloutVariations?: Array<{ variation: number; variationValue: unknown; weight: number }> } | undefined {
    const env = flag.environments[environmentKey];
    if (!env) return undefined;

    const fallthrough = env.fallthrough;
    
    if (fallthrough === null || fallthrough === undefined) {
        // Check _summary for fallthrough variation
        if (env._summary?.variations) {
            for (const [varIndex, varInfo] of Object.entries(env._summary.variations)) {
                if (varInfo.isFallthrough) {
                    const variationNum = parseInt(varIndex);
                    return {
                        variation: variationNum,
                        variationValue: getVariationValue(flag, variationNum),
                    };
                }
            }
        }
        return undefined;
    }

    if (isRollout(fallthrough)) {
        const rollout = fallthrough as { variations: Array<{ variation: number; weight: number }> };
        const rolloutVariations = rollout.variations
            .filter(v => v.weight > 0)
            .map(v => ({
                variation: v.variation,
                variationValue: getVariationValue(flag, v.variation),
                weight: v.weight,
            }));
        
        if (rolloutVariations.length > 0) {
            return {
                variation: rolloutVariations[0].variation, // Use first variation as primary
                variationValue: getVariationValue(flag, rolloutVariations[0].variation),
                isRollout: true,
                rolloutVariations: rolloutVariations,
            };
        }
        return undefined;
    }

    const fallthroughVariation = getFallthroughVariation(fallthrough);
    if (fallthroughVariation !== null) {
        return {
            variation: fallthroughVariation,
            variationValue: getVariationValue(flag, fallthroughVariation),
        };
    }

    return undefined;
}

function getOffVariationInfo(
    flag: Flag,
    environmentKey: string,
): { variation: number; variationValue: unknown } | undefined {
    const offVariation = getOffVariation(flag, environmentKey);
    if (offVariation === null) return undefined;
    
    return {
        variation: offVariation,
        variationValue: getVariationValue(flag, offVariation),
    };
}

function analyzeFlag(
    flag: Flag,
    status: FlagStatus,
    environmentKey: string,
    flagsMap: Map<string, Flag>,
    statusesMap: Map<string, FlagStatus>,
): Issue | null {
    const env = flag.environments[environmentKey];
    if (!env) {
        return null; // Flag doesn't exist in this environment
    }

    const fallbackValue = status.default;
    const flagOn = env.on;

    // Get prerequisites (environment-specific or flag-level)
    const prerequisites = env.prerequisites || flag.prerequisites || [];

    // Analyze prerequisites
    let prerequisiteWarning: string | null = null;
    let shouldUseOffVariation = false;
    let prerequisiteBlocked = false;

    if (prerequisites.length > 0) {
        for (const prereq of prerequisites) {
            const prereqFlag = flagsMap.get(prereq.key);
            const prereqStatus = statusesMap.get(prereq.key);

            if (!prereqFlag || !prereqStatus) {
                prerequisiteWarning = `Prerequisite flag '${prereq.key}' not found`;
                continue;
            }

            const prereqEnv = prereqFlag.environments[environmentKey];
            if (!prereqEnv) {
                prerequisiteWarning = `Prerequisite flag '${prereq.key}' not found in environment`;
                continue;
            }

            // If prerequisite is OFF, this flag should serve off variation
            if (!prereqEnv.on) {
                shouldUseOffVariation = true;
                prerequisiteBlocked = true;
                break;
            }

            // Check if prerequisite serves the required variation
            const prereqVariationsServed = getAllVariationsServed(prereqFlag, environmentKey);
            
            if (prereqVariationsServed.size === 1) {
                // Prerequisite serves only one variation
                if (!prereqVariationsServed.has(prereq.variation)) {
                    // Prerequisite check would fail - flag should serve off variation
                    shouldUseOffVariation = true;
                    prerequisiteBlocked = true;
                    break;
                }
                // Prerequisite check would pass - can ignore prerequisite
            } else if (prereqVariationsServed.size > 1) {
                // Prerequisite serves multiple variations
                if (prereqVariationsServed.has(prereq.variation)) {
                    // Prerequisite could pass, but it's not guaranteed
                    prerequisiteWarning = `Prerequisite flag '${prereq.key}' serves multiple variations - fallback may impact users when prerequisite check fails`;
                } else {
                    // Prerequisite check would fail - flag should serve off variation
                    shouldUseOffVariation = true;
                    prerequisiteBlocked = true;
                    break;
                }
            }
        }
    }

    // Always populate fallthrough and offVariation info
    const fallthroughInfo = getFallthroughInfo(flag, environmentKey);
    const offVariationInfo = getOffVariationInfo(flag, environmentKey);

    // Determine expected fallback value
    let expectedVariation: number | null = null;
    let recommendedFallback: unknown | unknown[] | undefined = undefined;
    let recommendedFallbackExplanation: string | undefined = undefined;
    let variationServing: VariationServing[] | undefined = undefined;

    if (prerequisiteBlocked || shouldUseOffVariation) {
        // Prerequisite blocked - should use off variation
        expectedVariation = getOffVariation(flag, environmentKey);
        if (expectedVariation !== null) {
            recommendedFallback = getVariationValue(flag, expectedVariation);
            if (prerequisiteBlocked) {
                recommendedFallbackExplanation = `Prerequisite flag(s) are blocking evaluation, so the flag should serve its off variation ${getVariationDisplayName(flag, expectedVariation)}`;
            } else {
                recommendedFallbackExplanation = `Flag is OFF, so fallback should match the off variation ${getVariationDisplayName(flag, expectedVariation)}`;
            }
        }
    } else if (!flagOn) {
        // Flag is OFF - fallback should match offVariation
        expectedVariation = getOffVariation(flag, environmentKey);
        if (expectedVariation !== null) {
            recommendedFallback = getVariationValue(flag, expectedVariation);
            recommendedFallbackExplanation = `Flag is OFF, so fallback should match the off variation ${getVariationDisplayName(flag, expectedVariation)}`;
        }
    } else {
        // Flag is ON - determine expected fallback
        const onlyServesOneVariation = checkFlagOnlyServesOneVariation(flag, environmentKey);
        
        if (onlyServesOneVariation) {
            // Get the single variation that's being served (could be from fallthrough, rules, or targets)
            const allVariationsServed = getAllVariationsServed(flag, environmentKey);
            if (allVariationsServed.size === 1) {
                const singleVariation = Array.from(allVariationsServed)[0];
                expectedVariation = singleVariation;
                recommendedFallback = getVariationValue(flag, singleVariation);
                recommendedFallbackExplanation = `Flag is ON and all rules, rollouts, fallthrough, and targets serve only ${getVariationDisplayName(flag, singleVariation)}`;
            }
        } else {
            // Multiple variations served - always get variation serving details
            variationServing = getVariationServing(flag, environmentKey);
            
            // Multiple variations served
            const allVariationsServed = getAllVariationsServed(flag, environmentKey);
            const offVariation = getOffVariation(flag, environmentKey);
            
            // When multiple variations are served, recommend the off variation as safest
            // (For multi-variant flags with >2 variations, this is always safest.
            // For boolean flags with 2 variations, off variation is still safer than recommending both values.)
            if (allVariationsServed.size > 1 && offVariation !== null) {
                recommendedFallback = getVariationValue(flag, offVariation);
                recommendedFallbackExplanation = `Flag serves multiple variations, so fallback should match the safe off variation ${getVariationDisplayName(flag, offVariation)} as the safest option.`;
            }
            // If we have no recommendations, leave recommendedFallback undefined - we can't safely recommend anything
        }
    }

    // Issue 1: Fallback value is not reported
    if (fallbackValue === undefined || fallbackValue === null) {
        // Always include variationServing to show off variation and fallthrough
        if (variationServing === undefined || variationServing.length === 0) {
            variationServing = getVariationServing(flag, environmentKey);
        }

        return {
            flagKey: flag.key,
            flagName: flag.name,
            tags: flag.tags,
            severity: "unknown",
            reason: "Fallback value is not reported (no default property in flag status)",
            fallbackValue: fallbackValue,
            recommendedFallback: recommendedFallback,
            recommendedFallbackExplanation: recommendedFallbackExplanation,
            variationServing: variationServing,
            fallthrough: fallthroughInfo,
            offVariation: offVariationInfo,
            environmentOn: flagOn,
        };
    }

    // Compare fallback with expected value
    let valuesMatch = false;
    let incorrectVariation: number | null = null;
    let fallbackVariation: number | null = null;

    // Find which variation the fallback matches (if any)
    for (let i = 0; i < flag.variations.length; i++) {
        if (JSON.stringify(fallbackValue) === JSON.stringify(flag.variations[i].value)) {
            fallbackVariation = i;
            break;
        }
    }

    if (expectedVariation !== null) {
        const expectedValue = getVariationValue(flag, expectedVariation);
        valuesMatch = JSON.stringify(fallbackValue) === JSON.stringify(expectedValue);
        if (!valuesMatch) {
            incorrectVariation = fallbackVariation;
        }
    }

    // Check if flag serves multiple variations - if so, always warn even if fallback matches one variation
    const onlyServesOne = checkFlagOnlyServesOneVariation(flag, environmentKey);
    if (flagOn && !onlyServesOne) {
        // Flag serves multiple variations - always warn since fallback can't match all variations
        const allVariationsServed = getAllVariationsServed(flag, environmentKey);
        // Only recommend off variation if flag is multi-variant AND multiple variations are served
        const isMultiVariant = flag.variations.length > 1;
        if (allVariationsServed.size > 1 && isMultiVariant) {
            // Get variation serving details if not already available
            if (variationServing === undefined || variationServing.length === 0) {
                variationServing = getVariationServing(flag, environmentKey);
            }
            
            let reason: string;
            let impacted: ImpactedUser[] = [];
            let severity: "critical" | "warning";
            
            if (fallbackVariation !== null && allVariationsServed.has(fallbackVariation)) {
                // Fallback matches one of the served variations - users expecting other variations are impacted
                const unmatchedVariations = Array.from(allVariationsServed).filter(v => v !== fallbackVariation);
                const unmatchedDisplayNames = unmatchedVariations.map(v => getVariationDisplayName(flag, v));
                reason = `Flag serves multiple variations. Fallback matches ${getVariationDisplayName(flag, fallbackVariation)}, but users expecting ${unmatchedDisplayNames.join(", ")} will be impacted.`;
                severity = "warning"; // Some users impacted
                
                // Build impacted users list for unmatched variations
                for (const unmatchedVar of unmatchedVariations) {
                    const impactedForVariation = getImpactedUsers(flag, environmentKey, unmatchedVar);
                    impacted.push(...impactedForVariation);
                }
                
                // For multi-variation flags, always recommend the off variation as safest
                const offVariation = getOffVariation(flag, environmentKey);
                if (offVariation !== null) {
                    recommendedFallback = getVariationValue(flag, offVariation);
                    recommendedFallbackExplanation = `Flag serves multiple variations, so fallback should match the safe off variation ${getVariationDisplayName(flag, offVariation)} as the safest option.`;
                }
            } else {
                // Fallback doesn't match any served variation
                const allDisplayNames = Array.from(allVariationsServed).map(v => getVariationDisplayName(flag, v));
                const offVariation = getOffVariation(flag, environmentKey);
                
                // Check if fallback matches the off variation
                const fallbackMatchesOff = offVariation !== null && fallbackVariation === offVariation;
                
                if (fallbackMatchesOff) {
                    // Fallback is the off variation - this is safe but still a warning
                    reason = `Flag serves multiple variations (${allDisplayNames.join(", ")}), but fallback matches the off variation ${getVariationDisplayName(flag, offVariation)}. This is safe but users expecting other variations will be impacted.`;
                    severity = "warning"; // Warning because off variation is safe, but not critical
                    
                    // Mark all served variations as impacted (users expecting these will get off variation instead)
                    for (const variation of allVariationsServed) {
                        const impactedForVariation = getImpactedUsers(flag, environmentKey, variation);
                        impacted.push(...impactedForVariation);
                    }
                } else {
                    // Fallback doesn't match any variation including off variation - all users impacted
                    reason = `Flag serves multiple variations (${allDisplayNames.join(", ")}), but fallback (${JSON.stringify(fallbackValue)}) doesn't match any of them. All users will be impacted.`;
                    severity = "critical"; // Critical because fallback is wrong and not even the safe off variation
                    
                    // Mark all variations as impacted
                    for (const variation of allVariationsServed) {
                        const impactedForVariation = getImpactedUsers(flag, environmentKey, variation);
                        impacted.push(...impactedForVariation);
                    }
                    
                    // If no specific impacted users found, mark fallthrough as impacted
                    if (impacted.length === 0) {
                        const fallthroughVariation = getSingleVariationFromFallthrough(flag, environmentKey);
                        if (fallthroughVariation !== null) {
                            impacted = [{
                                type: "fallthrough",
                                variation: fallthroughVariation,
                            }];
                        }
                    }
                }
                
                // Always recommend the off variation as the safe fallback when fallback doesn't match any served variation
                if (offVariation !== null) {
                    recommendedFallback = getVariationValue(flag, offVariation);
                    recommendedFallbackExplanation = `Flag serves multiple variations, so fallback should match the safe off variation ${getVariationDisplayName(flag, offVariation)} as the safest option.`;
                }
            }

            return {
                flagKey: flag.key,
                flagName: flag.name,
                tags: flag.tags,
                severity: severity,
                reason: reason,
                fallbackValue: fallbackValue,
                recommendedFallback: recommendedFallback,
                recommendedFallbackExplanation: recommendedFallbackExplanation,
                impacted: impacted.length > 0 ? impacted : undefined,
                variationServing: variationServing,
                fallthrough: fallthroughInfo,
                offVariation: offVariationInfo,
                environmentOn: flagOn,
            };
        }
    }

    // Build issue if there's a mismatch
    if (!valuesMatch && expectedVariation !== null) {
        const expectedValue = getVariationValue(flag, expectedVariation);
        const onlyServesOne = checkFlagOnlyServesOneVariation(flag, environmentKey);
        const severity = onlyServesOne ? "critical" : "warning";
        
        // Always include variationServing to show off variation and fallthrough
        if (variationServing === undefined || variationServing.length === 0) {
            variationServing = getVariationServing(flag, environmentKey);
        }
        
        let reason = prerequisiteBlocked 
            ? `Prerequisite blocked - flag should serve off variation, but fallback (${JSON.stringify(fallbackValue)}) does not match (${JSON.stringify(expectedValue)})`
            : onlyServesOne
            ? `Flag is ON and serves only one ${getVariationDisplayName(flag, expectedVariation)}, but fallback (${JSON.stringify(fallbackValue)}) does not match expected value (${JSON.stringify(expectedValue)})`
            : `Flag fallback (${JSON.stringify(fallbackValue)}) does not match expected value (${JSON.stringify(expectedValue)})`;
        
        if (prerequisiteWarning) {
            reason += `. ${prerequisiteWarning}`;
        }

        const impacted = incorrectVariation !== null 
            ? getImpactedUsers(flag, environmentKey, incorrectVariation)
            : undefined;

        // If no specific impacted users found but there's a mismatch, include fallthrough as default
        let finalImpacted = impacted;
        if ((impacted === undefined || impacted.length === 0) && expectedVariation !== null) {
            const allVariations = getAllVariationsServed(flag, environmentKey);
            if (allVariations.size > 0) {
                // Check if incorrectVariation is actually served by this flag
                if (incorrectVariation !== null && allVariations.has(incorrectVariation)) {
                    // The incorrect fallback matches a variation that IS served - find where it's served
                    const fallthroughVariation = getSingleVariationFromFallthrough(flag, environmentKey);
                    if (fallthroughVariation !== null && fallthroughVariation === incorrectVariation) {
                        finalImpacted = [{
                            type: "fallthrough",
                            variation: fallthroughVariation,
                        }];
                    } else {
                        // Re-check with getImpactedUsers - it should have found something, but if not, mark as fallthrough
                        finalImpacted = [{
                            type: "fallthrough",
                            variation: incorrectVariation,
                        }];
                    }
                } else {
                    // The incorrect fallback doesn't match any served variation - all users are impacted
                    // Mark that the fallthrough (expected) variation is what should be served
                    const fallthroughVariation = getSingleVariationFromFallthrough(flag, environmentKey);
                    if (fallthroughVariation !== null) {
                        finalImpacted = [{
                            type: "fallthrough",
                            variation: fallthroughVariation,
                        }];
                    }
                }
            }
        }

        return {
            flagKey: flag.key,
            flagName: flag.name,
            tags: flag.tags,
            severity: severity,
            reason: reason,
            fallbackValue: fallbackValue,
            expectedValue: expectedValue,
            recommendedFallback: recommendedFallback,
            recommendedFallbackExplanation: recommendedFallbackExplanation,
            impacted: finalImpacted,
            variationServing: variationServing,
            fallthrough: fallthroughInfo,
            offVariation: offVariationInfo,
            environmentOn: flagOn,
        };
    }

    // If prerequisite warning exists but fallback matches, still report as warning
    if (prerequisiteWarning) {
        // Always include variationServing to show off variation and fallthrough
        if (variationServing === undefined || variationServing.length === 0) {
            variationServing = getVariationServing(flag, environmentKey);
        }

        return {
            flagKey: flag.key,
            flagName: flag.name,
            tags: flag.tags,
            severity: "warning",
            reason: prerequisiteWarning,
            fallbackValue: fallbackValue,
            recommendedFallback: recommendedFallback,
            recommendedFallbackExplanation: recommendedFallbackExplanation,
            variationServing: variationServing,
            fallthrough: fallthroughInfo,
            offVariation: offVariationInfo,
            environmentOn: flagOn,
        };
    }

    return null; // No issues found
}

async function generateFallbackReport(
    projectKey: string,
    environmentKey: string,
    apiKey: string,
    filterTags: string[],
): Promise<{ issues: Issue[]; flagsMap: Map<string, Flag> }> {
    const issues: Issue[] = [];
    const flagsMap = new Map<string, Flag>();
    const statusesMap = new Map<string, FlagStatus>();

    // Fetch flags with environment-specific data
    const parameters = new URLSearchParams();
    parameters.append("expand", "evaluation");
    parameters.append("filter", `filterEnv:${environmentKey}`);
    parameters.append("summary", "0");

    for await (const flag of getAllFlags(projectKey, apiKey, parameters)) {
        const flagData = flag as unknown as Flag;
        flagsMap.set(flagData.key, flagData);
    }

    // Fetch flag statuses
    for await (const status of getAllFlagStatuses(projectKey, environmentKey, apiKey)) {
        const statusData = status as unknown as FlagStatus;
        const flagKey = extractFlagKeyFromHref(statusData._links.parent.href);
        if (flagKey) {
            statusesMap.set(flagKey, statusData);
        }
    }

    // Analyze each flag
    for (const [flagKey, flag] of flagsMap) {
        if (filterTags.length > 0) {
            if (!flag.tags?.some(tag => filterTags.includes(tag))) {
                continue;
            }
        }

        const status = statusesMap.get(flagKey);
        if (!status) {
            // Flag exists but no status - this could be an issue
            issues.push({
                flagKey: flag.key,
                flagName: flag.name,
                tags: flag.tags,
                severity: "unknown",
                reason: "Flag exists but no status information available",
                fallbackValue: undefined,
                environmentOn: flag.environments[environmentKey]?.on ?? false,
            });
            continue;
        }

        const issue = analyzeFlag(flag, status, environmentKey, flagsMap, statusesMap);
        if (issue) {
            issues.push(issue);
        }
    }

    return { issues, flagsMap };
}

function renderMarkdown(
    projectKey: string,
    environmentKey: string,
    issues: Issue[],
    flagsMap: Map<string, Flag>,
    showTags: boolean = false,
): string {
    const now = new Date();
    const dateTime = now.toISOString();
    
    const critical = issues.filter((i) => i.severity === "critical");
    const warning = issues.filter((i) => i.severity === "warning");
    const unknown = issues.filter((i) => i.severity === "unknown");

    let markdown = `# Fallback Report\n\n`;
    markdown += `**Project:** ${projectKey}\n`;
    markdown += `**Environment:** ${environmentKey}\n`;
    markdown += `**Generated:** ${dateTime}\n\n`;
    markdown += `## Summary\n\n`;
    markdown += `- **Total Issues:** ${issues.length}\n`;
    markdown += `- **Critical:** ${critical.length}\n`;
    markdown += `- **Warning:** ${warning.length}\n`;
    markdown += `- **Unknown:** ${unknown.length}\n\n`;

    if (critical.length > 0) {
        markdown += `## Critical Issues\n\n`;
        for (const issue of critical) {
            markdown += `### ${issue.flagName || issue.flagKey}\n\n`;
            markdown += `\`**Key:** ${issue.flagKey}\`\n\n`;
            if (showTags && issue.tags && issue.tags.length > 0) {
                markdown += `**Tags:** ${issue.tags.map(tag => `\`${tag}\``).join(", ")}\n\n`;
            }
            markdown += `**Severity:** ${issue.severity.toUpperCase()}\n\n`;
            markdown += `**Issue:** ${issue.reason}\n\n`;
            markdown += `**Fallback Value:** \`${JSON.stringify(issue.fallbackValue)}\`\n\n`;
            if (issue.recommendedFallback !== undefined) {
                markdown += `**Recommended Fallback:** \`${JSON.stringify(issue.recommendedFallback)}\`\n\n`;
            }
            if (issue.recommendedFallbackExplanation) {
                markdown += `**Explanation:** ${issue.recommendedFallbackExplanation}\n\n`;
            }
            if (issue.variationServing && issue.variationServing.length > 0) {
                markdown += `**Variations Served:**\n\n`;
                for (const serving of issue.variationServing) {
                    const flag = flagsMap.get(issue.flagKey);
                    const variationDisplay = flag ? getVariationDisplayName(flag, serving.variation) : `Variation ${serving.variation} (\`${JSON.stringify(serving.variationValue)}\`)`;
                    markdown += `- **${variationDisplay}:**\n`;
                    if (serving.fallthrough) {
                        markdown += `  - Fallthrough${serving.fallthrough.weight ? ` (weight: ${serving.fallthrough.weight})` : ""}\n`;
                    }
                    if (serving.rules && serving.rules.length > 0) {
                        for (const rule of serving.rules) {
                            if (rule.ruleIndex === -1) {
                                markdown += `  - Rule(s) (details not available)\n`;
                            } else {
                                markdown += `  - Rule ${rule.ruleIndex}${rule.weight ? ` (weight: ${rule.weight})` : ""}\n`;
                            }
                        }
                    }
                    if (serving.targets && serving.targets.length > 0) {
                        for (const target of serving.targets) {
                            markdown += `  - Targets: ${target.values?.join(", ") || "N/A"}\n`;
                        }
                    }
                    if (serving.contextTargets && serving.contextTargets.length > 0) {
                        for (const target of serving.contextTargets) {
                            markdown += `  - Context Targets (${target.contextKind || "user"}): ${target.values?.join(", ") || "N/A"}\n`;
                        }
                    }
                }
                markdown += `\n`;
            }
            if (issue.impacted && issue.impacted.length > 0) {
                markdown += `**Impacted:**\n\n`;
                markdown += `This section shows which rules, targets, context targets, or fallthrough configurations serve variations that differ from the fallback value. Users matching these conditions may receive an unexpected variation due to the fallback mismatch.\n\n`;
                for (const impactedItem of issue.impacted) {
                    markdown += `- **Type:** ${impactedItem.type}`;
                    if (impactedItem.type === "target" || impactedItem.type === "contextTarget") {
                        markdown += ` | **Values:** ${impactedItem.values?.join(", ") || "N/A"}`;
                        if (impactedItem.contextKind) {
                            markdown += ` | **Context Kind:** ${impactedItem.contextKind}`;
                        }
                    } else if (impactedItem.type === "rule") {
                        markdown += ` | **Rule Index:** ${impactedItem.ruleIndex}`;
                        if (impactedItem.weight !== undefined) {
                            markdown += ` | **Weight:** ${impactedItem.weight}`;
                        }
                    } else if (impactedItem.type === "fallthrough") {
                        if (impactedItem.weight !== undefined) {
                            markdown += ` | **Weight:** ${impactedItem.weight}`;
                        }
                    }
                    markdown += ` | **Variation:** `;
                    const flag = flagsMap.get(issue.flagKey);
                    if (flag) {
                        markdown += getVariationDisplayName(flag, impactedItem.variation);
                    } else {
                        markdown += `${impactedItem.variation}`;
                    }
                    markdown += `\n`;
                }
                markdown += `\n`;
            }
            if (issue.fallthrough) {
                markdown += `**Fallthrough:** `;
                const flag = flagsMap.get(issue.flagKey);
                if (flag) {
                    markdown += getVariationDisplayName(flag, issue.fallthrough.variation);
                    if (issue.fallthrough.isRollout && issue.fallthrough.rolloutVariations) {
                        markdown += ` (Rollout)\n\n`;
                        for (const rolloutVar of issue.fallthrough.rolloutVariations) {
                            markdown += `  - ${getVariationDisplayName(flag, rolloutVar.variation)} (weight: ${rolloutVar.weight})\n`;
                        }
                    } else {
                        markdown += `\n\n`;
                    }
                } else {
                    markdown += `Variation ${issue.fallthrough.variation} (\`${JSON.stringify(issue.fallthrough.variationValue)}\`)\n\n`;
                }
            }
            if (issue.offVariation) {
                markdown += `**Off Variation:** `;
                const flag = flagsMap.get(issue.flagKey);
                if (flag) {
                    markdown += getVariationDisplayName(flag, issue.offVariation.variation);
                } else {
                    markdown += `Variation ${issue.offVariation.variation} (\`${JSON.stringify(issue.offVariation.variationValue)}\`)`;
                }
                markdown += `\n\n`;
            }
            markdown += `**Environment ON:** ${issue.environmentOn}\n\n`;
            markdown += `---\n\n`;
        }
    }

    if (warning.length > 0) {
        markdown += `## Warnings\n\n`;
        for (const issue of warning) {
            markdown += `### ${issue.flagName || issue.flagKey}\n\n`;
            markdown += `\`${issue.flagKey}\`\n\n`;
            if (showTags && issue.tags && issue.tags.length > 0) {
                markdown += `**Tags:** ${issue.tags.map(tag => `\`${tag}\``).join(", ")}\n\n`;
            }
            markdown += `**Severity:** ${issue.severity.toUpperCase()}\n\n`;
            markdown += `**Issue:** ${issue.reason}\n\n`;
            markdown += `**Fallback Value:** \`${JSON.stringify(issue.fallbackValue)}\`\n\n`;
            if (issue.expectedValue !== undefined) {
                markdown += `**Expected Value:** \`${JSON.stringify(issue.expectedValue)}\`\n\n`;
            }
            if (issue.recommendedFallback !== undefined) {
                markdown += `**Recommended Fallback:** \`${JSON.stringify(issue.recommendedFallback)}\`\n\n`;
            }
            if (issue.recommendedFallbackExplanation) {
                markdown += `**Explanation:** ${issue.recommendedFallbackExplanation}\n\n`;
            }
            if (issue.variationServing && issue.variationServing.length > 0) {
                markdown += `**Variations Served:**\n\n`;
                for (const serving of issue.variationServing) {
                    const flag = flagsMap.get(issue.flagKey);
                    const variationDisplay = flag ? getVariationDisplayName(flag, serving.variation) : `Variation ${serving.variation} (\`${JSON.stringify(serving.variationValue)}\`)`;
                    markdown += `- **${variationDisplay}:**\n`;
                    if (serving.fallthrough) {
                        markdown += `  - Fallthrough${serving.fallthrough.weight ? ` (weight: ${serving.fallthrough.weight})` : ""}\n`;
                    }
                    if (serving.rules && serving.rules.length > 0) {
                        for (const rule of serving.rules) {
                            if (rule.ruleIndex === -1) {
                                markdown += `  - Rule(s) (details not available)\n`;
                            } else {
                                markdown += `  - Rule ${rule.ruleIndex}${rule.weight ? ` (weight: ${rule.weight})` : ""}\n`;
                            }
                        }
                    }
                    if (serving.targets && serving.targets.length > 0) {
                        for (const target of serving.targets) {
                            markdown += `  - Targets: ${target.values?.join(", ") || "N/A"}\n`;
                        }
                    }
                    if (serving.contextTargets && serving.contextTargets.length > 0) {
                        for (const target of serving.contextTargets) {
                            markdown += `  - Context Targets (${target.contextKind || "user"}): ${target.values?.join(", ") || "N/A"}\n`;
                        }
                    }
                }
                markdown += `\n`;
            }
            if (issue.impacted && issue.impacted.length > 0) {
                markdown += `**Impacted:**\n\n`;
                markdown += `This section shows which rules, targets, context targets, or fallthrough configurations serve variations that differ from the fallback value. Users matching these conditions may receive an unexpected variation due to the fallback mismatch.\n\n`;
                
                for (const impactedItem of issue.impacted) {
                    markdown += `- **Type:** ${impactedItem.type}`;
                    if (impactedItem.type === "target" || impactedItem.type === "contextTarget") {
                        markdown += ` | **Values:** ${impactedItem.values?.join(", ") || "N/A"}`;
                        if (impactedItem.contextKind) {
                            markdown += ` | **Context Kind:** ${impactedItem.contextKind}`;
                        }
                    } else if (impactedItem.type === "rule") {
                        markdown += ` | **Rule Index:** ${impactedItem.ruleIndex}`;
                        if (impactedItem.weight !== undefined) {
                            markdown += ` | **Weight:** ${impactedItem.weight}`;
                        }
                    } else if (impactedItem.type === "fallthrough") {
                        if (impactedItem.weight !== undefined) {
                            markdown += ` | **Weight:** ${impactedItem.weight}`;
                        }
                    }
                    markdown += ` | **Variation:** `;
                    const flag = flagsMap.get(issue.flagKey);
                    if (flag) {
                        markdown += getVariationDisplayName(flag, impactedItem.variation);
                    } else {
                        markdown += `${impactedItem.variation}`;
                    }
                    markdown += `\n`;
                }
                markdown += `\n`;
            }
            if (issue.fallthrough) {
                markdown += `**Fallthrough:** `;
                const flag = flagsMap.get(issue.flagKey);
                if (flag) {
                    markdown += getVariationDisplayName(flag, issue.fallthrough.variation);
                    if (issue.fallthrough.isRollout && issue.fallthrough.rolloutVariations) {
                        markdown += ` (Rollout)\n\n`;
                        for (const rolloutVar of issue.fallthrough.rolloutVariations) {
                            markdown += `  - ${getVariationDisplayName(flag, rolloutVar.variation)} (weight: ${rolloutVar.weight})\n`;
                        }
                    } else {
                        markdown += `\n\n`;
                    }
                } else {
                    markdown += `Variation ${issue.fallthrough.variation} (\`${JSON.stringify(issue.fallthrough.variationValue)}\`)\n\n`;
                }
            }
            if (issue.offVariation) {
                markdown += `**Off Variation:** `;
                const flag = flagsMap.get(issue.flagKey);
                if (flag) {
                    markdown += getVariationDisplayName(flag, issue.offVariation.variation);
                } else {
                    markdown += `Variation ${issue.offVariation.variation} (\`${JSON.stringify(issue.offVariation.variationValue)}\`)`;
                }
                markdown += `\n\n`;
            }
            markdown += `---\n\n`;
        }
    }

    if (unknown.length > 0) {
        markdown += `## Unknown/Missing Data\n\n`;
        for (const issue of unknown) {
            markdown += `### ${issue.flagName || issue.flagKey}\n\n`;
            markdown += `\`${issue.flagKey}\`\n\n`;
            if (showTags && issue.tags && issue.tags.length > 0) {
                markdown += `**Tags:** ${issue.tags.map(tag => `\`${tag}\``).join(", ")}\n\n`;
            }
            markdown += `**Reason:** ${issue.reason}\n\n`;
            if (issue.recommendedFallback !== undefined) {
                markdown += `**Recommended Fallback:** \`${JSON.stringify(issue.recommendedFallback)}\`\n\n`;
            }
            if (issue.recommendedFallbackExplanation) {
                markdown += `**Explanation:** ${issue.recommendedFallbackExplanation}\n\n`;
            }
            if (issue.variationServing && issue.variationServing.length > 0) {
                markdown += `**Variations Served:**\n\n`;
                for (const serving of issue.variationServing) {
                    const flag = flagsMap.get(issue.flagKey);
                    const variationDisplay = flag ? getVariationDisplayName(flag, serving.variation) : `Variation ${serving.variation} (\`${JSON.stringify(serving.variationValue)}\`)`;
                    markdown += `- **${variationDisplay}:**\n`;
                    if (serving.fallthrough) {
                        markdown += `  - Fallthrough${serving.fallthrough.weight ? ` (weight: ${serving.fallthrough.weight})` : ""}\n`;
                    }
                    if (serving.rules && serving.rules.length > 0) {
                        for (const rule of serving.rules) {
                            if (rule.ruleIndex === -1) {
                                markdown += `  - Rule(s) (details not available)\n`;
                            } else {
                                markdown += `  - Rule ${rule.ruleIndex}${rule.weight ? ` (weight: ${rule.weight})` : ""}\n`;
                            }
                        }
                    }
                    if (serving.targets && serving.targets.length > 0) {
                        for (const target of serving.targets) {
                            markdown += `  - Targets: ${target.values?.join(", ") || "N/A"}\n`;
                        }
                    }
                    if (serving.contextTargets && serving.contextTargets.length > 0) {
                        for (const target of serving.contextTargets) {
                            markdown += `  - Context Targets (${target.contextKind || "user"}): ${target.values?.join(", ") || "N/A"}\n`;
                        }
                    }
                }
                markdown += `\n`;
            }
            if (issue.impacted && issue.impacted.length > 0) {
                markdown += `**Impacted:**\n\n`;
                markdown += `This section shows which rules, targets, context targets, or fallthrough configurations serve variations that differ from the fallback value. Users matching these conditions may receive an unexpected variation due to the fallback mismatch.\n\n`;
                for (const impactedItem of issue.impacted) {
                    markdown += `- **Type:** ${impactedItem.type}`;
                    if (impactedItem.type === "target" || impactedItem.type === "contextTarget") {
                        markdown += ` | **Values:** ${impactedItem.values?.join(", ") || "N/A"}`;
                        if (impactedItem.contextKind) {
                            markdown += ` | **Context Kind:** ${impactedItem.contextKind}`;
                        }
                    } else if (impactedItem.type === "rule") {
                        markdown += ` | **Rule Index:** ${impactedItem.ruleIndex}`;
                        if (impactedItem.weight !== undefined) {
                            markdown += ` | **Weight:** ${impactedItem.weight}`;
                        }
                    } else if (impactedItem.type === "fallthrough") {
                        if (impactedItem.weight !== undefined) {
                            markdown += ` | **Weight:** ${impactedItem.weight}`;
                        }
                    }
                    markdown += ` | **Variation:** `;
                    const flag = flagsMap.get(issue.flagKey);
                    if (flag) {
                        markdown += getVariationDisplayName(flag, impactedItem.variation);
                    } else {
                        markdown += `${impactedItem.variation}`;
                    }
                    markdown += `\n`;
                }
                markdown += `\n`;
            }
            if (issue.fallthrough) {
                markdown += `**Fallthrough:** `;
                const flag = flagsMap.get(issue.flagKey);
                if (flag) {
                    markdown += getVariationDisplayName(flag, issue.fallthrough.variation);
                    if (issue.fallthrough.isRollout && issue.fallthrough.rolloutVariations) {
                        markdown += ` (Rollout)\n\n`;
                        for (const rolloutVar of issue.fallthrough.rolloutVariations) {
                            markdown += `  - ${getVariationDisplayName(flag, rolloutVar.variation)} (weight: ${rolloutVar.weight})\n`;
                        }
                    } else {
                        markdown += `\n\n`;
                    }
                } else {
                    markdown += `Variation ${issue.fallthrough.variation} (\`${JSON.stringify(issue.fallthrough.variationValue)}\`)\n\n`;
                }
            }
            if (issue.offVariation) {
                markdown += `**Off Variation:** `;
                const flag = flagsMap.get(issue.flagKey);
                if (flag) {
                    markdown += getVariationDisplayName(flag, issue.offVariation.variation);
                } else {
                    markdown += `Variation ${issue.offVariation.variation} (\`${JSON.stringify(issue.offVariation.variationValue)}\`)`;
                }
                markdown += `\n\n`;
            }
            markdown += `---\n\n`;
        }
    }

    return markdown;
}

// Main execution
if (import.meta.main) {
    const flags = parseArgs(Deno.args, {
        string: ["format", "filter-tags"],
        boolean: ["show-tags"],
        default: { format: "json", "filter-tags": "", "show-tags": false },
    });

    // Parse and clean filter tags
    const filterTags = flags["filter-tags"]
        .split(",")
        .map(t => t.trim())
        .filter(t => t.length > 0);

    if (flags.format !== "json" && flags.format !== "markdown") {
        console.error(`Error: Invalid format "${flags.format}". Must be "json" or "markdown"`);
        Deno.exit(1);
    }

    // If filter-tags is set for markdown output, imply show-tags
    // (JSON output always includes tags regardless of the flag)
    if (filterTags.length > 0 && flags.format === "markdown" && !flags["show-tags"]) {
        flags["show-tags"] = true;
    }

    const API_KEY = Deno.env.get("LD_API_KEY");
    if (!API_KEY) {
        console.error(
            "Error: LD_API_KEY environment variable is required",
        );
        Deno.exit(1);
    }

    const projectKey = flags._[0] as string | undefined;
    if (!projectKey) {
        console.error("Error: Project key argument is required");
        console.error("Usage: fallback-report.ts <project-key> <environment-key> [--format json|markdown] [--show-tags] [--filter-tags tag1,tag2]");
        Deno.exit(1);
    }

    const environmentKey = flags._[1] as string | undefined;
    if (!environmentKey) {
        console.error("Error: Environment key argument is required");
        console.error("Usage: fallback-report.ts <project-key> <environment-key> [--format json|markdown] [--show-tags] [--filter-tags tag1,tag2]");
        Deno.exit(1);
    }

    generateFallbackReport(projectKey, environmentKey, API_KEY, filterTags)
        .then(({ issues, flagsMap }) => {
            const reportData = {
                projectKey,
                environmentKey,
                totalIssues: issues.length,
                summary: {
                    critical: issues.filter((i) => i.severity === "critical").length,
                    warning: issues.filter((i) => i.severity === "warning").length,
                    unknown: issues.filter((i) => i.severity === "unknown").length,
                },
                issues: issues,
            };

            if (flags.format === "markdown") {
                console.log(renderMarkdown(projectKey, environmentKey, issues, flagsMap, flags["show-tags"]));
            } else {
                console.log(JSON.stringify(reportData, null, 2));
            }

            Deno.exit(0);
        })
        .catch((error) => {
            if (flags.format === "markdown") {
                console.error(`# Error\n\nError generating fallback report: ${error.message}`);
            } else {
                console.error(JSON.stringify({
                    error: "Error generating fallback report",
                    message: error.message,
                }, null, 2));
            }
            Deno.exit(1);
        });
}

