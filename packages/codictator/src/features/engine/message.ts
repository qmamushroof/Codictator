// SPEC §4.3.7: the agent-facing verdict text. E2 covers the block shape
// the §4.3 EC rows assert (rule names, Why, Do instead, the count line);
// the full message budget copy lands with step 4.8.
import { redactSecrets } from "../../kernel/index.ts";
import type { Decision, Finding } from "./index.ts";

// SPEC §4.3.7: the agent message stays inside 1,200 bytes.
export const MAX_MESSAGE_BYTES = 1200;

function byteLength(text: string): number {
	return new TextEncoder().encode(text).length;
}

function truncateUtf8(text: string, maxBytes: number): string {
	const bytes = new TextEncoder().encode(text);
	if (bytes.length <= maxBytes) {
		return text;
	}
	let cut = maxBytes;
	while (cut > 0) {
		const byte = bytes[cut];
		if (byte === undefined || (byte & 0xc0) !== 0x80) {
			break;
		}
		cut -= 1;
	}
	return new TextDecoder().decode(bytes.subarray(0, cut));
}

function ruleIdsOf(findings: ReadonlyArray<Finding>): Array<string> {
	const seen = new Set<string>();
	for (const finding of findings) {
		seen.add(finding.ruleId);
	}
	return [...seen].sort();
}

// SPEC §4.3.7: at most the first three findings render in full, then a
// count line for the rest.
export function buildMessage(
	decision: Decision,
	findings: ReadonlyArray<Finding>,
	eventId: string,
): string {
	const verb =
		decision === "allow"
			? "allowed"
			: decision === "advise"
				? "flagged for review"
				: "blocked";
	if (findings.length === 0) {
		return redactSecrets(
			`Codictator ${verb} this: no findings remain. (event ${eventId})`,
		);
	}
	const rules = ruleIdsOf(findings);
	const detail: Array<string> = [];
	for (const finding of findings.slice(0, 3)) {
		detail.push(`- [${finding.ruleId}] Why: ${finding.message}`);
		detail.push(`  Do instead: ${finding.remediation}`);
	}
	const lines = [`Codictator ${verb} this: ${rules.join(", ")}`, ...detail];
	if (findings.length > 3) {
		lines.push(`and ${findings.length - 3} more — codictator verify`);
	}
	lines.push(
		`More: codictator explain ${rules[0] ?? "unknown"} (event ${eventId})`,
	);
	// SPEC §4.3.9 EC-14: the message is redacted by the kernel; findings
	// stay raw so remediation keeps its data.
	let message = redactSecrets(lines.join("\n"));
	if (byteLength(message) > MAX_MESSAGE_BYTES) {
		const trimmed = lines.slice(0, 1);
		if (findings.length > 3) {
			trimmed.push(`and ${findings.length} more — codictator verify`);
		}
		trimmed.push(lines[lines.length - 1] ?? "");
		message = redactSecrets(trimmed.join("\n"));
	}
	if (byteLength(message) > MAX_MESSAGE_BYTES) {
		message = `${truncateUtf8(message, MAX_MESSAGE_BYTES - 20)}[truncated]`;
	}
	return message;
}
