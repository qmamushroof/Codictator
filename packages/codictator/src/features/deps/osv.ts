// SPEC §4.8.2: OSV advisories over the Net port. One advisory source covers
// every ecosystem; the query goes to querybatch and affected ranges resolve
// through the vuln detail, so withdrawn advisories clear on fresh fetch
// (EC-11) without any stored state here.
import {
	err,
	makeError,
	type Net,
	ok,
	parseJson,
	type Result,
} from "../../kernel/index.ts";
import { field, isJsonRecord, stringField } from "./fields.ts";
import { narrowOsvRanges, type OsvRange } from "./osv-ranges.ts";

export const OSV_BASE_URL = "https://api.osv.dev";

export type { OsvEvent, OsvRange } from "./osv-ranges.ts";
export {
	narrowOsvRanges,
	osvAdvisoryAffects,
	osvRangeAffectsVersion,
} from "./osv-ranges.ts";

function narrowIdList(value: unknown): ReadonlyArray<string> {
	if (!isJsonRecord(value)) {
		return [];
	}
	const vulns = field(value, "vulns");
	if (!Array.isArray(vulns)) {
		return [];
	}
	const ids: Array<string> = [];
	for (const entry of vulns) {
		if (isJsonRecord(entry)) {
			const id = stringField(entry, "id");
			if (id !== undefined) {
				ids.push(id);
			}
		}
	}
	return ids;
}

export interface OsvFetchOptions {
	readonly baseUrl?: string;
	readonly timeoutMs?: number;
	readonly retries?: number;
	readonly sleep?: (ms: number) => Promise<void>;
}

export const OSV_TIMEOUT_MS = 30_000;

// SPEC §4.8.8 EC-5: retryable statuses retry with backoff, then CDX-E401 and
// block (fail closed). Sleep is injected so tests never wait on the clock.
export function isRetryableStatus(status: number): boolean {
	return status === 429 || (status >= 500 && status <= 599);
}

export function retryDelaysMs(): ReadonlyArray<number> {
	return [1000, 4000];
}

function advisoryError(
	message: string,
	remediation: string,
): ReturnType<typeof err<string>> {
	return err(makeError("CDX-E401", message, remediation));
}

async function postJson(
	net: Net,
	url: string,
	body: string,
	options: OsvFetchOptions,
): Promise<Result<string>> {
	const retries = options.retries ?? retryDelaysMs().length;
	const delays = retryDelaysMs();
	let attempt = 0;
	for (;;) {
		const sent = await net.request({
			method: "POST",
			url,
			headers: { "content-type": "application/json" },
			body,
			timeoutMs: options.timeoutMs ?? OSV_TIMEOUT_MS,
		});
		if (!sent.ok) {
			return err(sent.error);
		}
		const response = sent.value;
		if (response.status === 200) {
			return ok(response.body);
		}
		if (isRetryableStatus(response.status) && attempt < retries) {
			const delay = delays[Math.min(attempt, delays.length - 1)] ?? 1000;
			if (options.sleep !== undefined) {
				await options.sleep(delay);
			}
			attempt += 1;
			continue;
		}
		return advisoryError(
			`OSV query failed with status ${String(response.status)} for ${url}`,
			"Retry the sweep; if OSV stays unavailable the run blocks fail-closed.",
		);
	}
}

async function getJson(
	net: Net,
	url: string,
	options: OsvFetchOptions,
): Promise<Result<string>> {
	const retries = options.retries ?? retryDelaysMs().length;
	const delays = retryDelaysMs();
	let attempt = 0;
	for (;;) {
		const sent = await net.request({
			method: "GET",
			url,
			headers: {},
			timeoutMs: options.timeoutMs ?? OSV_TIMEOUT_MS,
		});
		if (!sent.ok) {
			return err(sent.error);
		}
		const response = sent.value;
		if (response.status === 200) {
			return ok(response.body);
		}
		if (isRetryableStatus(response.status) && attempt < retries) {
			const delay = delays[Math.min(attempt, delays.length - 1)] ?? 1000;
			if (options.sleep !== undefined) {
				await options.sleep(delay);
			}
			attempt += 1;
			continue;
		}
		return advisoryError(
			`OSV fetch failed with status ${String(response.status)} for ${url}`,
			"Retry the sweep; if OSV stays unavailable the run blocks fail-closed.",
		);
	}
}

// SPEC §4.8.2: querybatch first, then one vuln fetch per id for the affected
// ranges. Withdrawn ids vanish from querybatch, clearing the finding (EC-11).
export async function fetchOsvAdvisoryIds(
	net: Net,
	ecosystem: string,
	name: string,
	version: string,
	options: OsvFetchOptions = {},
): Promise<Result<ReadonlyArray<string>>> {
	const base = options.baseUrl ?? OSV_BASE_URL;
	const queried = await postJson(
		net,
		`${base}/v1/querybatch`,
		JSON.stringify({
			queries: [{ package: { name, ecosystem }, version }],
		}),
		options,
	);
	if (!queried.ok) {
		return err(queried.error);
	}
	const parsed = parseJson(queried.value);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	if (!isJsonRecord(parsed.value)) {
		return ok([]);
	}
	const results = field(parsed.value, "results");
	if (!Array.isArray(results)) {
		return ok([]);
	}
	const ids: Array<string> = [];
	for (const entry of results) {
		if (isJsonRecord(entry)) {
			for (const id of narrowIdList({ vulns: field(entry, "vulns") })) {
				if (!ids.includes(id)) {
					ids.push(id);
				}
			}
		}
	}
	return ok(ids.sort());
}

export async function fetchOsvRanges(
	net: Net,
	id: string,
	options: OsvFetchOptions = {},
): Promise<Result<ReadonlyArray<OsvRange>>> {
	const base = options.baseUrl ?? OSV_BASE_URL;
	const fetched = await getJson(net, `${base}/v1/vulns/${id}`, options);
	if (!fetched.ok) {
		return err(fetched.error);
	}
	const parsed = parseJson(fetched.value);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	return ok(narrowOsvRanges(parsed.value));
}
