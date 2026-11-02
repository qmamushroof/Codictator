// SPEC §4.13: shared step kinds, ranks and builders for the remediation
// planner. Single owner of the kind tables (ranks, executors) and the
// unnumbered step shape the chain builders emit.
import type { RemediationStep, SizeBudget } from "./types.ts";

export const DEFAULT_SIZE_BUDGET: SizeBudget = { files: 10, lines: 300 };

const KIND_RANK: Readonly<Record<string, number>> = {
	"restore-green": 0,
	"floor-immediate": 1,
	"safety-net": 2,
	"dep-update": 3,
	"dep-major": 4,
	"dep-consolidate": 5,
	"arch-move": 6,
	"debt-reduce": 7,
	docs: 8,
};

const KIND_EXECUTOR: Readonly<Record<string, string>> = {
	"restore-green": "agent",
	"floor-immediate": "codictator",
	"safety-net": "agent",
	"dep-update": "codictator",
	"dep-major": "agent",
	"dep-consolidate": "agent",
	"arch-move": "agent",
	"debt-reduce": "agent",
	docs: "agent",
};

export interface StepSpec {
	readonly kind: string;
	readonly scope: ReadonlyArray<string>;
	readonly executor: string;
	readonly after: ReadonlyArray<number>;
	readonly status: string;
	readonly targetRule: string | undefined;
	readonly targetKey: string | undefined;
}

export interface DepMajorInput {
	readonly package: string;
	readonly from: string;
	readonly to: string;
	readonly needsCoverage: boolean;
	readonly needsToolchain: boolean;
	readonly workspaces?: ReadonlyArray<string> | undefined;
}

// A step without an id yet; `after` holds positions in the same array, so
// the planner numbers a chain without the builder guessing ids.
export interface UnnumberedStep {
	readonly after: ReadonlyArray<number>;
	readonly step: Omit<RemediationStep, "id" | "dependsOn">;
}

export interface StranglerInput {
	readonly fromEntry: string;
	readonly toEntry: string;
	readonly importers: ReadonlyArray<string>;
	readonly batchFiles?: number | undefined;
}

export function rankOf(kind: string): number {
	return KIND_RANK[kind] ?? 99;
}

export function scopeKey(scope: ReadonlyArray<string>): string {
	return [...scope].sort().join("\n");
}

export function numberedBase(
	kind: string,
	scope: ReadonlyArray<string>,
): Omit<RemediationStep, "id" | "dependsOn"> {
	return {
		kind,
		scope: [...scope],
		executor: KIND_EXECUTOR[kind] ?? "agent",
		status: "pending",
		attempts: 0,
		target: [],
		sizeBudget: { ...DEFAULT_SIZE_BUDGET },
		expectedDelta: 1,
		children: [],
	};
}
