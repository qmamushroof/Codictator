// SPEC §4.5.1: the pre-engine deny in the harness's own form, split from
// runtime.ts by responsibility (CONVENTIONS size). staticBlock carries no
// engine state, so the launcher and the CLI start path use it when the
// engine cannot run (CDX-E002, CDX-E003).
import type { HookReply } from "./contract.ts";
import { adapterFor } from "./hook-dispatch.ts";

export function supportedHarness(harness: string): boolean {
	return adapterFor(harness) !== undefined;
}

export function staticBlock(
	harness: string,
	code: string,
	message: string,
): HookReply | undefined {
	const adapter = adapterFor(harness);
	if (adapter === undefined) {
		return undefined;
	}
	return adapter.staticBlock(code, message);
}
