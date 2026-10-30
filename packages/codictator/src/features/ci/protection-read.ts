// SPEC §4.15.2 + §4.15.7 EC-1/EC-6: the live branch-protection read behind
// `ci verify`. Pure over Net/Env: branch rules go first, classic second;
// unreadable resolves to undefined (advise), readable classic 404 to
// blocking (EC-7, reported-not-protected).
import { type Env, type Net, parseJson } from "../../kernel/index.ts";
import type { ProtectionRead } from "./protection.ts";

const DEFAULT_API_URL = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Dynamic-key read: literal dot access would widen the unknown, and literal
// bracket access trips useLiteralKeys, so every JSON field goes through here.
function field(record: Record<string, unknown>, key: string): unknown {
	return record[key];
}

function stringItems(value: unknown): Array<string> | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const out: Array<string> = [];
	for (const item of value) {
		if (typeof item !== "string") {
			return undefined;
		}
		out.push(item);
	}
	return out;
}

// Classic protection bodies list required contexts two ways: the legacy
// `contexts` strings and the newer `checks` objects carrying `context`.
// Null or absent means no required checks (fail closed downstream), while a
// malformed shape means the read cannot be trusted (advise downstream).
function requiredContexts(checks: unknown): Array<string> | undefined {
	if (checks === null || checks === undefined) {
		return [];
	}
	if (!isRecord(checks)) {
		return undefined;
	}
	const legacy = stringItems(field(checks, "contexts"));
	if (legacy !== undefined) {
		return legacy;
	}
	const modern = field(checks, "checks");
	if (!Array.isArray(modern)) {
		return undefined;
	}
	const out: Array<string> = [];
	for (const entry of modern) {
		if (!isRecord(entry)) {
			return undefined;
		}
		const context = field(entry, "context");
		if (typeof context !== "string") {
			return undefined;
		}
		out.push(context);
	}
	return out;
}

function enabledFlag(body: unknown, key: string): boolean | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const section = field(body, key);
	if (!isRecord(section)) {
		return undefined;
	}
	const enabled = field(section, "enabled");
	return typeof enabled === "boolean" ? enabled : undefined;
}

function defaultBranchOf(body: unknown): string | undefined {
	if (!isRecord(body)) {
		return undefined;
	}
	const branch = field(body, "default_branch");
	return typeof branch === "string" && branch !== "" ? branch : undefined;
}

// SPEC §4.15.2: a required check is verify-shaped when its context is the
// gate's name. Matrix jobs append a parenthesised suffix (`verify
// (ubuntu-latest)`), stripped before the exact match, so `pre-verify` fails.
function verifyBaseOf(context: string): string {
	return context
		.replace(/\s*\([^)]*\)\s*$/, "")
		.trim()
		.toLowerCase();
}

function verifyRequiredIn(contexts: ReadonlyArray<string>): boolean {
	return contexts.some((context) => verifyBaseOf(context) === "verify");
}

// SPEC §4.15.2: the branch-rules endpoint answers an array of repository
// rules; anything else falls through to classic, never assumes.
function protectionFromRuleset(
	rulesBody: string,
	repoBody: unknown,
): ProtectionRead | undefined {
	const parsed = parseJson(rulesBody);
	if (!parsed.ok || !Array.isArray(parsed.value)) {
		return undefined;
	}
	const contexts: Array<string> = [];
	let forcePushBlocked = false;
	let deletionBlocked = false;
	for (const entry of parsed.value) {
		if (!isRecord(entry) || typeof field(entry, "type") !== "string") {
			return undefined;
		}
		const type = field(entry, "type");
		forcePushBlocked = forcePushBlocked || type === "non_fast_forward";
		deletionBlocked = deletionBlocked || type === "deletion";
		if (type !== "required_status_checks") {
			continue;
		}
		const params = field(entry, "parameters");
		if (!isRecord(params)) {
			return undefined;
		}
		const checks = field(params, "required_status_checks");
		if (!Array.isArray(checks)) {
			return undefined;
		}
		for (const check of checks) {
			if (!isRecord(check)) {
				return undefined;
			}
			const context = field(check, "context");
			if (typeof context !== "string") {
				return undefined;
			}
			contexts.push(context);
		}
	}
	const squash = isRecord(repoBody)
		? field(repoBody, "allow_squash_merge")
		: undefined;
	return {
		readable: true,
		verifyRequired: verifyRequiredIn(contexts),
		forcePushBlocked,
		deletionBlocked,
		...(typeof squash === "boolean" ? { allowSquashMerge: squash } : {}),
	};
}

function protectionFrom(body: string): ProtectionRead | undefined {
	const parsed = parseJson(body);
	if (!parsed.ok || !isRecord(parsed.value)) {
		return undefined;
	}
	const contexts = requiredContexts(
		field(parsed.value, "required_status_checks"),
	);
	if (contexts === undefined) {
		return undefined;
	}
	const squash = field(parsed.value, "allow_squash_merge");
	const forcePushes = enabledFlag(parsed.value, "allow_force_pushes");
	const deletions = enabledFlag(parsed.value, "allow_deletions");
	return {
		readable: true,
		verifyRequired: verifyRequiredIn(contexts),
		...(forcePushes === undefined ? {} : { forcePushBlocked: !forcePushes }),
		...(deletions === undefined ? {} : { deletionBlocked: !deletions }),
		...(typeof squash === "boolean" ? { allowSquashMerge: squash } : {}),
	};
}

// SPEC §4.15.2 EC-7: reported-not-protected is readable, so every missing
// setting blocks instead of advising.
function unprotectedRead(): ProtectionRead {
	return {
		readable: true,
		verifyRequired: false,
		forcePushBlocked: false,
		deletionBlocked: false,
		allowSquashMerge: true,
	};
}

function repoRefOf(
	value: string | undefined,
): { owner: string; repo: string } | undefined {
	if (value === undefined || value === "") {
		return undefined;
	}
	const parts = value.split("/");
	if (parts.length !== 2) {
		return undefined;
	}
	const owner = parts[0];
	const repo = parts[1];
	if (
		owner === undefined ||
		owner === "" ||
		repo === undefined ||
		repo === ""
	) {
		return undefined;
	}
	return { owner, repo };
}

function repoUrl(api: string, ref: { owner: string; repo: string }): string {
	return `${api}/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`;
}

// SPEC §4.15.7 EC-1/EC-6: outside Actions, without a token, or on any
// unreadable answer (403, timeout, network error) the read is absent and the
// gate advises; it never throws, so a host outage cannot fail the run.
export async function readProtection(
	net: Net,
	env: Env,
): Promise<ProtectionRead | undefined> {
	if (env.get("GITHUB_ACTIONS") !== "true") {
		return undefined;
	}
	const token = env.get("GITHUB_TOKEN");
	const ref = repoRefOf(env.get("GITHUB_REPOSITORY"));
	if (token === undefined || token === "" || ref === undefined) {
		return undefined;
	}
	const api = (env.get("GITHUB_API_URL") ?? DEFAULT_API_URL).replace(
		/\/+$/,
		"",
	);
	if (api === "") {
		return undefined;
	}
	const headers = {
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${token}`,
		// GitHub rejects API calls without a UA (403 "Request forbidden by
		// administrative rules"); without this the read always advises.
		"User-Agent": "codictator",
		"X-GitHub-Api-Version": "2022-11-28",
	};
	const repoSeen = await net.request({
		method: "GET",
		url: repoUrl(api, ref),
		headers,
		timeoutMs: REQUEST_TIMEOUT_MS,
	});
	if (!repoSeen.ok || repoSeen.value.status !== 200) {
		return undefined;
	}
	const repoParsed = parseJson(repoSeen.value.body);
	if (!repoParsed.ok) {
		return undefined;
	}
	const branch = defaultBranchOf(repoParsed.value);
	if (branch === undefined) {
		return undefined;
	}
	// SPEC §4.15.2: rulesets first; unreadable or untrustworthy answers
	// fall through to classic, only a readable ruleset resolves here.
	const rulesSeen = await net.request({
		method: "GET",
		url: `${repoUrl(api, ref)}/rules/branches/${encodeURIComponent(branch)}`,
		headers,
		timeoutMs: REQUEST_TIMEOUT_MS,
	});
	if (rulesSeen.ok && rulesSeen.value.status === 200) {
		const ruleset = protectionFromRuleset(
			rulesSeen.value.body,
			repoParsed.value,
		);
		if (ruleset !== undefined) {
			return ruleset;
		}
	}
	const seen = await net.request({
		method: "GET",
		url: `${repoUrl(api, ref)}/branches/${encodeURIComponent(branch)}/protection`,
		headers,
		timeoutMs: REQUEST_TIMEOUT_MS,
	});
	if (!seen.ok) {
		return undefined;
	}
	if (seen.value.status === 404) {
		return unprotectedRead();
	}
	if (seen.value.status !== 200) {
		return undefined;
	}
	return protectionFrom(seen.value.body);
}
