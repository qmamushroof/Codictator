// SPEC §4.2: config load, validate, tighten. Owns the §7.2 format.
export interface ConfigTunable {
	readonly params: Readonly<Record<string, unknown>>;
}

export interface Config {
	readonly version: 1;
	readonly codictator: string;
	readonly packs: ReadonlyArray<{
		readonly id: string;
		readonly version?: string;
		readonly path?: string;
	}>;
	readonly harnesses: ReadonlyArray<string>;
	readonly tunables: Readonly<Record<string, ConfigTunable>>;
	readonly architecture?: unknown;
	readonly workflow?: unknown;
	readonly spec?: unknown;
	readonly testing?: unknown;
	readonly commands?: Readonly<Record<string, ReadonlyArray<string>>>;
	readonly steering?: unknown;
	readonly tools?: ReadonlyArray<unknown>;
	readonly security?: unknown;
	readonly deps?: unknown;
	readonly network?: unknown;
	readonly integrity?: unknown;
	readonly ci?: unknown;
	readonly llm?: unknown;
}

export interface EffectiveConfig {
	readonly config: Config;
	readonly configHash: string;
}

// SPEC §4.2.1: resolution order is repo config, then tighten-only overrides.
export function loadConfig(_repoRoot: string): Promise<EffectiveConfig> {
	throw new Error("not implemented: SPEC §4.2.1");
}

// SPEC §4.2.2: tunables tighten only; any loosening is an error.
export function validateConfig(_value: unknown): EffectiveConfig {
	throw new Error("not implemented: SPEC §4.2.2");
}
