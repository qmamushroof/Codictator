// SPEC §4.7.1 detectors, implemented here in the kernel so engine, audit,
// adapters and generator can redact without importing security (§3.3).
// Every match is replaced by its first 4 characters plus its length;
// env references, placeholders and fixture paths are left unchanged.
const KNOWN_FORMATS: ReadonlyArray<RegExp> = [
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bghp_[A-Za-z0-9]{36,}\b/g,
	/\bgho_[A-Za-z0-9]{36,}\b/g,
	/\bghs_[A-Za-z0-9]{36,}\b/g,
	/\bghu_[A-Za-z0-9]{36,}\b/g,
	/\bghr_[A-Za-z0-9]{36,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{22,}\b/g,
	/\bglpat-[A-Za-z0-9_-]{20,}/g,
	/\bxox[abposr]-[A-Za-z0-9-]{8,}/g,
	/\b[rs]k_live_[A-Za-z0-9]{16,}/g,
	/\bAIza[A-Za-z0-9_-]{35}\b/g,
	/\bnpm_[A-Za-z0-9]{36}\b/g,
	/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
];

const ASSIGNMENT_PATTERN =
	/["']?([A-Za-z0-9_.$-]*(?:secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|client[_-]?secret))["']?\s*[:=]\s*["']?([^\s"'`;,]+)["']?/gi;

const ALLOW_PATTERNS: ReadonlyArray<RegExp> = [
	/process\.env\.[A-Za-z_][A-Za-z0-9_]*/g,
	/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g,
	/\$[A-Za-z_][A-Za-z0-9_]*/g,
	/os\.environ\s*\[[^\]\n]*\]/g,
];

const PLACEHOLDER_PATTERN = /^(?:x+|changeme|example|your[-_].*|<.*>)$/i;

interface Span {
	readonly start: number;
	readonly end: number;
	readonly replacement: string;
}

function allowSpans(text: string): Array<Span> {
	const spans: Array<Span> = [];
	for (const pattern of ALLOW_PATTERNS) {
		pattern.lastIndex = 0;
		let match = pattern.exec(text);
		while (match !== null) {
			spans.push({
				start: match.index,
				end: match.index + match[0].length,
				replacement: match[0],
			});
			match = pattern.exec(text);
		}
	}
	return spans;
}

function overlaps(
	start: number,
	end: number,
	spans: ReadonlyArray<Span>,
): boolean {
	return spans.some((span) => start < span.end && end > span.start);
}

function redact(match: string): string {
	return `${match.slice(0, 4)}…(${match.length})`;
}

function shannonPerChar(value: string): number {
	const counts = new Map<string, number>();
	for (const char of value) {
		counts.set(char, (counts.get(char) ?? 0) + 1);
	}
	let entropy = 0;
	for (const count of counts.values()) {
		const probability = count / value.length;
		entropy -= probability * Math.log2(probability);
	}
	return entropy;
}

function isAllowedSecret(candidate: string): boolean {
	return PLACEHOLDER_PATTERN.test(candidate);
}

function assignmentSpans(text: string): Array<Span> {
	const spans: Array<Span> = [];
	ASSIGNMENT_PATTERN.lastIndex = 0;
	let match = ASSIGNMENT_PATTERN.exec(text);
	while (match !== null) {
		const candidate = match[2] ?? "";
		const full = match[0];
		if (
			candidate.length >= 20 &&
			shannonPerChar(candidate) >= 4 &&
			!isAllowedSecret(candidate)
		) {
			spans.push({
				start: match.index,
				end: match.index + full.length,
				replacement: redact(full),
			});
		}
		match = ASSIGNMENT_PATTERN.exec(text);
	}
	return spans;
}

function formatSpans(text: string): Array<Span> {
	const spans: Array<Span> = [];
	for (const pattern of KNOWN_FORMATS) {
		pattern.lastIndex = 0;
		let match = pattern.exec(text);
		while (match !== null) {
			const found = match[0];
			if (!isAllowedSecret(found)) {
				spans.push({
					start: match.index,
					end: match.index + found.length,
					replacement: redact(found),
				});
			}
			match = pattern.exec(text);
		}
	}
	return spans;
}

export function redactSecrets(text: string): string {
	const allowed = allowSpans(text);
	const candidates = [...formatSpans(text), ...assignmentSpans(text)];
	candidates.sort((a, b) => a.start - b.start || b.end - a.end);
	const kept: Array<Span> = [];
	for (const span of candidates) {
		if (overlaps(span.start, span.end, allowed)) {
			continue;
		}
		if (kept.some((used) => span.start < used.end && span.end > used.start)) {
			continue;
		}
		kept.push(span);
	}
	kept.sort((a, b) => a.start - b.start);
	let out = "";
	let cursor = 0;
	for (const span of kept) {
		out += text.slice(cursor, span.start);
		out += span.replacement;
		cursor = span.end;
	}
	return out + text.slice(cursor);
}
