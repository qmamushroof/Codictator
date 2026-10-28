// SPEC §4.13, formats §7.6 and §7.13: the shared baseline and remediation
// plan vocabulary. Every other remediation module imports these types from
// here, so index.ts stays a pure re-export surface (§4.11 EC-4).
export interface Baseline {
	readonly version: 1;
	readonly entries: Readonly<Record<string, Readonly<Record<string, number>>>>;
}

// SPEC §7.13 step target: the rule id and metric key the step must move,
// with the count at generation time.
export interface PlanTarget {
	readonly ruleId: string;
	readonly key: string;
	readonly from: number;
}

export interface SizeBudget {
	readonly files: number;
	readonly lines: number;
}

export interface RemediationStep {
	readonly id: string;
	readonly kind: string;
	readonly scope: ReadonlyArray<string>;
	readonly executor: string;
	readonly dependsOn: ReadonlyArray<string>;
	readonly status: string;
	readonly attempts: number;
	readonly target?: ReadonlyArray<PlanTarget> | undefined;
	readonly sizeBudget?: SizeBudget | undefined;
	readonly expectedDelta?: number | undefined;
	readonly children?: ReadonlyArray<string> | undefined;
	readonly taskId?: string | undefined;
	readonly branch?: string | undefined;
	readonly lastFailure?: string | undefined;
}

export interface RemediationPlan {
	readonly version: 1;
	readonly generatedFrom: {
		readonly head: string;
		readonly baselineHash: string;
	};
	readonly steps: ReadonlyArray<RemediationStep>;
}
