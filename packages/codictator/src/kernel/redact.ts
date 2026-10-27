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

// Keyword-first half of the assignment detector (SPEC §4.7.1): the same
// keyword alternation the old `["']?([A-Za-z0-9_.$-]*...)` pattern used,
// run alone so the engine can use a literal search instead of backtracking
// the leading name-character run at every position.
const KEYWORD_PATTERN =
	/secret|token|passw(?:or)?d|api[_-]?key|private[_-]?key|client[_-]?secret/gi;

// Sticky tail of an assignment match, anchored at the end of the keyword:
// the optional quote, separator and value run of the original pattern,
// split so the value (group 2) stays available for the entropy check.
const ASSIGNMENT_MID = /["']?\s*[:=]\s*["']?/y;
const ASSIGNMENT_VALUE = /[^\s"'`;,]+/y;

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

// The `[A-Za-z0-9_.$-]` name class of the assignment detector as char
// codes, for the backward scan to the start of the name run.
function isNameChar(code: number): boolean {
	return (
		(code >= 0x30 && code <= 0x39) ||
		(code >= 0x41 && code <= 0x5a) ||
		(code >= 0x61 && code <= 0x7a) ||
		code === 0x24 ||
		code === 0x2e ||
		code === 0x2d ||
		code === 0x5f
	);
}

function isQuote(value: string | undefined): boolean {
	return value === '"' || value === "'";
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
	// Keyword-first scan: the original leading `[A-Za-z0-9_.$-]*` made the
	// engine backtrack over every long run of name characters (quadratic on
	// inputs like 65KB of `a`). Anchoring each attempt at a keyword keeps
	// every scan over disjoint input, and the pieces below reuse the exact
	// character classes of the original pattern, so matches are unchanged.
	KEYWORD_PATTERN.lastIndex = 0;
	let keyword = KEYWORD_PATTERN.exec(text);
	let floor = 0;
	while (keyword !== null) {
		const keywordStart = keyword.index;
		const keywordEnd = keywordStart + keyword[0].length;
		if (keywordStart >= floor) {
			ASSIGNMENT_MID.lastIndex = keywordEnd;
			const mid = ASSIGNMENT_MID.exec(text);
			if (mid !== null) {
				ASSIGNMENT_VALUE.lastIndex = ASSIGNMENT_MID.lastIndex;
				const value = ASSIGNMENT_VALUE.exec(text);
				if (value !== null) {
					let end = ASSIGNMENT_VALUE.lastIndex;
					if (isQuote(text[end])) {
						end += 1;
					}
					let start = keywordStart;
					while (start > 0 && isNameChar(text.charCodeAt(start - 1))) {
						start -= 1;
					}
					if (start > 0 && isQuote(text[start - 1])) {
						start -= 1;
					}
					const candidate = value[0];
					const full = text.slice(start, end);
					if (
						candidate.length >= 20 &&
						shannonPerChar(candidate) >= 4 &&
						!isAllowedSecret(candidate)
					) {
						spans.push({
							start,
							end,
							replacement: redact(full),
						});
					}
					floor = end;
				}
			}
		}
		keyword = KEYWORD_PATTERN.exec(text);
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

function mergeSpans(spans: ReadonlyArray<Span>): Array<Span> {
	const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
	const merged: Array<Span> = [];
	for (const span of sorted) {
		const last = merged[merged.length - 1];
		if (last === undefined || span.start >= last.end) {
			merged.push(span);
		} else if (span.end > last.end) {
			merged[merged.length - 1] = { ...last, end: span.end };
		}
	}
	return merged;
}

export function redactSecrets(text: string): string {
	// Both lists are sorted and non-overlapping after merging, so one sweep
	// each replaces the per-candidate overlap scans (SPEC §4.7.1: the sort
	// keeps the widest of overlapping candidates first, so the survivor is
	// unchanged).
	const allowed = mergeSpans(allowSpans(text));
	const candidates = [...formatSpans(text), ...assignmentSpans(text)];
	candidates.sort((a, b) => a.start - b.start || b.end - a.end);
	const parts: Array<string> = [];
	let cursor = 0;
	let allowedIndex = 0;
	for (const span of candidates) {
		if (span.start < cursor) {
			continue;
		}
		while (
			allowedIndex < allowed.length &&
			(allowed[allowedIndex]?.end ?? 0) <= span.start
		) {
			allowedIndex += 1;
		}
		const blocker = allowed[allowedIndex];
		if (blocker !== undefined && blocker.start < span.end) {
			continue;
		}
		parts.push(text.slice(cursor, span.start));
		parts.push(span.replacement);
		cursor = span.end;
	}
	parts.push(text.slice(cursor));
	return parts.join("");
}
