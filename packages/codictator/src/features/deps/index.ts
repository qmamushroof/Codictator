// SPEC §4.8: dependency enforcers, bot config, upgrades. Owns the §7.12
// registry snapshot format.
import type { Result } from "../../kernel/index.ts";
import type { CheckContext, Finding } from "../engine/index.ts";

export interface ManifestDependency {
	readonly name: string;
	readonly range: string;
}

export interface Manifest {
	readonly ecosystem: string;
	readonly path: string;
	readonly dependencies: ReadonlyArray<ManifestDependency>;
}

export interface RegistryVersion {
	readonly published: string;
	readonly deprecated?: boolean;
	readonly yanked?: boolean;
	readonly license?: string;
}

export interface RegistrySnapshot {
	readonly version: 1;
	readonly ecosystem: string;
	readonly fetchedAt: string;
	readonly packages: Readonly<
		Record<
			string,
			{ readonly versions: Readonly<Record<string, RegistryVersion>> }
		>
	>;
	readonly advisories: Readonly<Record<string, ReadonlyArray<string>>>;
}

export interface FileEdit {
	readonly path: string;
	readonly old: string;
	readonly replacement: string;
}

// SPEC §3.4: ecosystem driver contract.
export interface Driver {
	readonly ecosystem: string;
	readonly detect: (repo: string) => boolean;
	readonly readManifests: (repo: string) => Array<Manifest>;
	readonly registry: RegistryClient;
	readonly edit: (upgrade: Upgrade) => Array<FileEdit>;
}

export interface Upgrade {
	readonly name: string;
	readonly from: string;
	readonly to: string;
}

export interface RegistryClient {
	readonly snapshot: (
		names: ReadonlyArray<string>,
	) => Promise<Result<RegistrySnapshot>>;
}

// SPEC §4.8.3: latest-stable resolution against the snapshot.
export function resolveLatest(
	_snapshot: RegistrySnapshot,
	_name: string,
): Result<string> {
	throw new Error("not implemented: SPEC §4.8.3");
}

// SPEC §4.8.5: dependency verdicts for the evaluation path.
export function checkDeps(
	_ctx: CheckContext,
	_manifests: ReadonlyArray<Manifest>,
): Promise<Array<Finding>> {
	throw new Error("not implemented: SPEC §4.8.5");
}
