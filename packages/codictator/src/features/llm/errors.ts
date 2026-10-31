// SPEC §4.17.4: the client-side error constructors. Every failure is a
// CdxError with a SPEC §8 code; the key itself never appears in a message,
// a detail or an event (SPEC §4.17.3, §9.2).
import { type CdxError, makeError } from "../../kernel/index.ts";

export function keyMissingError(name: string): CdxError {
	return makeError(
		"CDX-E852",
		`LLM API key is not set: environment variable ${name} is unset`,
		`Export ${name} with the provider key, then retry. The key is read at call time and never stored.`,
	);
}

export function keyRejectedError(
	status: number,
	keyName: string | undefined,
): CdxError {
	return makeError(
		"CDX-E852",
		`LLM provider rejected the API key (status ${String(status)})`,
		keyName === undefined
			? "Check the provider key the local runtime expects, then retry."
			: `Check the value of ${keyName} (the value itself is never logged), then retry.`,
	);
}

export function unavailableError(detail: string): CdxError {
	return makeError(
		"CDX-E854",
		`LLM provider is unavailable: ${detail}`,
		"Retry the request; after repeated failures check the provider status and the generator falls back to --template.",
		detail,
	);
}

export function invalidDraftError(detail: string): CdxError {
	return makeError(
		"CDX-E853",
		`LLM draft is not valid JSON: ${detail}`,
		"Retry the request; the generator runs one repair round on invalid drafts.",
	);
}
