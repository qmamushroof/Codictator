// SPEC §4.19.8 step 2: the npm registry document for codictator, reduced
// to the latest dist-tag and the published versions.
import type { Result } from "../kernel/index.ts";
import { err, makeError, ok, parseJson } from "../kernel/index.ts";
import { portsFor } from "./shared.ts";

const REGISTRY_URL = "https://registry.npmjs.org/codictator";

export interface UpgradeRegistry {
	readonly latest: string;
	readonly versions: ReadonlyArray<string>;
}

function unreadable(): Result<UpgradeRegistry> {
	return err(
		makeError(
			"CDX-E401",
			"npm registry answered with an unreadable document for codictator",
			"Retry with network access.",
		),
	);
}

function narrowRegistry(text: string): Result<UpgradeRegistry> {
	const parsed = parseJson(text);
	if (!parsed.ok) {
		return unreadable();
	}
	const doc = parsed.value as {
		"dist-tags"?: { latest?: unknown };
		versions?: Record<string, unknown>;
	} | null;
	const latest = doc?.["dist-tags"]?.latest;
	if (typeof latest !== "string" || doc?.versions === undefined) {
		return unreadable();
	}
	return ok({ latest, versions: Object.keys(doc.versions) });
}

export async function liveLookup(
	root: string,
): Promise<Result<UpgradeRegistry>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	const sent = await ports.value.net.request({
		method: "GET",
		url: REGISTRY_URL,
		headers: { accept: "application/json" },
		timeoutMs: 30_000,
	});
	if (!sent.ok) {
		return err(sent.error);
	}
	if (sent.value.status !== 200) {
		return err(
			makeError(
				"CDX-E401",
				`npm registry answered ${String(sent.value.status)} for codictator`,
				"Retry with network access.",
			),
		);
	}
	return narrowRegistry(sent.value.body);
}
