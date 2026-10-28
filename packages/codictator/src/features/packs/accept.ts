// SPEC §4.4.7: acceptance of custom packs. `codictator pack accept` is
// human-only, runs the self-test, then writes accepted.json (§7.4); any
// later byte change invalidates it and the loader holds the pack inert.
import path from "node:path";
import type { CdxError, Ports, Result } from "../../kernel/index.ts";
import { err, makeError, ok, stableStringify } from "../../kernel/index.ts";
import { requireHuman } from "../config/index.ts";
import { ACCEPTED_NAME, packHashFor, selfTestHashFor } from "./hashes.ts";
import type { PackAccepted } from "./index.ts";
import { loadPack } from "./loader.ts";
import { selfTest } from "./selftest.ts";

export interface AcceptPackOptions {
	readonly isTty: boolean;
	readonly agentMarkers?: ReadonlyArray<string>;
}

function refused(error: unknown): Result<never> {
	if (
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string" &&
		"message" in error &&
		typeof error.message === "string" &&
		"remediation" in error &&
		typeof error.remediation === "string"
	) {
		const coded: CdxError = {
			code: error.code,
			message: error.message,
			remediation: error.remediation,
		};
		return err(coded);
	}
	return err(
		makeError(
			"CDX-E901",
			"pack accept refused without a coded error",
			"Retry in an interactive terminal, then re-run codictator pack accept.",
		),
	);
}

function toPosix(value: string): string {
	return value.split(path.sep).join("/");
}

// SPEC §4.4.7: human-only acceptance after a green self-test. Paths read
// through the caller's ports in caller form; the CLI passes repo-relative
// pack dirs with repo-rooted ports.
export async function acceptPack(
	packDir: string,
	ports: Ports,
	options: AcceptPackOptions,
): Promise<Result<PackAccepted>> {
	try {
		requireHuman(ports.env, options.isTty, options.agentMarkers ?? []);
	} catch (error) {
		return refused(error);
	}
	const dirForm = toPosix(packDir);
	const loaded = await loadPack(packDir, { ports, skipAcceptance: true });
	if (!loaded.ok) {
		return err(loaded.error);
	}
	const tested = await selfTest(loaded.value);
	if (!tested.ok) {
		return err(tested.error);
	}
	const hashed = await packHashFor(ports.fs, dirForm);
	if (!hashed.ok) {
		return err(hashed.error);
	}
	const email = await ports.git.config("user.email");
	if (!email.ok) {
		return err(email.error);
	}
	if (email.value.trim().length === 0) {
		return err(
			makeError(
				"CDX-E903",
				"git user.email is not set; pack acceptance needs an author",
				"Set git user.email, then re-run codictator pack accept.",
			),
		);
	}
	const accepted: PackAccepted = {
		version: 1,
		packHash: hashed.value,
		selfTestHash: selfTestHashFor(loaded.value.manifest),
		acceptedAt: ports.clock.now(),
		acceptedBy: email.value.trim(),
	};
	const written = await ports.fs.write(
		`${dirForm}/${ACCEPTED_NAME}`,
		new TextEncoder().encode(stableStringify(accepted)),
	);
	if (!written.ok) {
		return err(written.error);
	}
	return ok(accepted);
}
