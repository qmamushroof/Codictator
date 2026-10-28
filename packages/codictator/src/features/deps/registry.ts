// SPEC §4.8.2 and §4.8.4: the npm registry document over the Net port, the
// §7.12 snapshot it feeds, and the freshness rules per layer. Every call
// goes through the Net allowlist (§9.2); 127.0.0.1 replay servers arrive as
// an injected base URL in tests, never as production code.
import {
	err,
	makeError,
	type Net,
	ok,
	parseJson,
	type Result,
	sha256Text,
	stableStringify,
} from "../../kernel/index.ts";
import { field, isJsonRecord, recordField, stringField } from "./fields.ts";
import type { RegistrySnapshot } from "./index.ts";
import { isRetryableStatus, retryDelaysMs } from "./osv.ts";

export const NPM_REGISTRY_BASE_URL = "https://registry.npmjs.org";
export const REGISTRY_TIMEOUT_MS = 30_000;
export const SNAPSHOT_MAX_AGE_MS = 24 * 86_400_000;
export const SNAPSHOT_CACHE_PATH = ".codictator/cache/registry/npm.json";

export interface NpmDocVersion {
	readonly deprecated: boolean;
	readonly license: string | undefined;
	readonly engines: string | undefined;
}

export interface NpmPackument {
	readonly name: string;
	readonly unpublished: boolean;
	readonly times: Readonly<Record<string, string>>;
	readonly versions: Readonly<Record<string, NpmDocVersion>>;
}

function narrowPackument(name: string, value: unknown): NpmPackument {
	const empty: NpmPackument = {
		name,
		unpublished: true,
		times: {},
		versions: {},
	};
	if (!isJsonRecord(value)) {
		return empty;
	}
	const times: Record<string, string> = {};
	const timeTable = recordField(value, "time");
	if (timeTable !== undefined) {
		for (const [version, published] of Object.entries(timeTable)) {
			if (
				version !== "created" &&
				version !== "modified" &&
				typeof published === "string"
			) {
				times[version] = published;
			}
		}
	}
	const versions: Record<string, NpmDocVersion> = {};
	const versionTable = recordField(value, "versions");
	if (versionTable !== undefined) {
		for (const [version, detail] of Object.entries(versionTable)) {
			if (!isJsonRecord(detail)) {
				continue;
			}
			const enginesTable = recordField(detail, "engines");
			const engines =
				enginesTable === undefined
					? undefined
					: stringField(enginesTable, "node");
			versions[version] = {
				deprecated:
					typeof field(detail, "deprecated") === "string" ||
					field(detail, "deprecated") === true,
				license: stringField(detail, "license"),
				engines,
			};
		}
	}
	if (Object.keys(versions).length === 0) {
		return empty;
	}
	return { name, unpublished: false, times, versions };
}

export interface RegistryFetchOptions {
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
	readonly retries?: number;
	readonly sleep?: (ms: number) => Promise<void>;
}

// SPEC §4.8.2: the full document (the abbreviated form lacks `time`).
// A 404 is unpublished (EC-4), not a transport failure.
export async function fetchNpmPackument(
	net: Net,
	name: string,
	options: RegistryFetchOptions = {},
): Promise<Result<NpmPackument>> {
	const base = options.baseUrl ?? NPM_REGISTRY_BASE_URL;
	const url = `${base}/${encodeURIComponent(name)}`;
	const retries = options.retries ?? retryDelaysMs().length;
	const delays = retryDelaysMs();
	let attempt = 0;
	for (;;) {
		const sent = await net.request({
			method: "GET",
			url,
			headers: { accept: "application/json" },
			timeoutMs: options.timeoutMs ?? REGISTRY_TIMEOUT_MS,
		});
		if (!sent.ok) {
			return err(sent.error);
		}
		const response = sent.value;
		if (response.status === 200) {
			const parsed = parseJson(response.body);
			if (!parsed.ok) {
				return err(parsed.error);
			}
			return ok(narrowPackument(name, parsed.value));
		}
		if (response.status === 404) {
			return ok({
				name,
				unpublished: true,
				times: {},
				versions: {},
			});
		}
		if (isRetryableStatus(response.status) && attempt < retries) {
			const delay = delays[Math.min(attempt, delays.length - 1)] ?? 1000;
			if (options.sleep !== undefined) {
				await options.sleep(delay);
			}
			attempt += 1;
			continue;
		}
		return err(
			makeError(
				"CDX-E401",
				`npm registry query for ${name} failed with status ${String(response.status)}`,
				"Retry the sweep; without registry data dependency changes block fail-closed.",
			),
		);
	}
}

// SPEC §4.8.4: each run stores the fetched documents it used with fetchedAt;
// the snapshot hash enters every verdict (§4.3.6).
export function buildSnapshot(
	ecosystem: string,
	fetchedAt: string,
	packuments: ReadonlyArray<NpmPackument>,
	advisories: Readonly<Record<string, ReadonlyArray<string>>>,
): RegistrySnapshot {
	const packages: Record<
		string,
		{
			versions: Record<
				string,
				{
					published: string;
					deprecated?: boolean;
					yanked?: boolean;
					license?: string;
					engines?: string;
				}
			>;
		}
	> = {};
	for (const doc of packuments) {
		const versions: Record<
			string,
			{
				published: string;
				deprecated?: boolean;
				yanked?: boolean;
				license?: string;
				engines?: string;
			}
		> = {};
		for (const version of Object.keys(doc.versions).sort()) {
			const detail = doc.versions[version];
			const published = doc.times[version];
			if (detail === undefined || published === undefined) {
				continue;
			}
			versions[version] = {
				published,
				...(detail.deprecated ? { deprecated: true as const } : {}),
				...(detail.license !== undefined ? { license: detail.license } : {}),
				...(detail.engines !== undefined ? { engines: detail.engines } : {}),
			};
		}
		packages[doc.name] = { versions };
	}
	return {
		version: 1,
		ecosystem,
		fetchedAt,
		packages,
		advisories: { ...advisories },
	};
}

export function hashSnapshot(snapshot: RegistrySnapshot): string {
	return sha256Text(stableStringify(snapshot));
}

// SPEC §4.8.4: L1 and L3 reuse a snapshot younger than 24 h; L4 and L5
// always fetch fresh. Offline, L1/L3 say "as of fetchedAt"; with no usable
// snapshot, dependency changes block with CDX-E401.
export type SnapshotFreshness = "fresh" | "stale" | "missing";

export function snapshotFreshness(
	snapshot: RegistrySnapshot | undefined,
	now: string,
): SnapshotFreshness {
	if (snapshot === undefined) {
		return "missing";
	}
	const nowMs = Date.parse(now);
	const fetchedMs = Date.parse(snapshot.fetchedAt);
	if (Number.isNaN(nowMs) || Number.isNaN(fetchedMs) || fetchedMs > nowMs) {
		return "missing";
	}
	return nowMs - fetchedMs < SNAPSHOT_MAX_AGE_MS ? "fresh" : "stale";
}

export function snapshotAsOf(snapshot: RegistrySnapshot): string {
	return `as of ${snapshot.fetchedAt}`;
}
