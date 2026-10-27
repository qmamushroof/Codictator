// SPEC §4.3.5: ratchet count rules over flattened metric-key counts. The
// caller flattens baseline.json §7.6 entries, namespacing each rule's keys
// under "<ruleId>@<measureVersion>", so a pack bumping measureVersion
// arrives as fresh keys enforcing at zero while old-measure keys never
// reach this comparison. The touched-file rule
// (core/ratchet-touched-improves) and the content-based rename move belong
// to the verdict layer; this function owns only the count rows.
interface CountEntry {
	readonly key: string;
	readonly count: number;
}

// SPEC §4.3.5: a count above its baseline blocks — worse than recorded.
// Counts at or below baseline pass as recorded debt.
function keysAboveBaseline(
	baseline: Readonly<Record<string, number>>,
	current: Readonly<Record<string, number>>,
): Array<string> {
	const violations: Array<string> = [];
	for (const key of Object.keys(baseline).sort()) {
		if (!Object.hasOwn(current, key)) {
			continue;
		}
		const before = baseline[key] ?? 0;
		const now = current[key] ?? 0;
		if (now > before) {
			violations.push(key);
		}
	}
	return violations;
}

// SPEC §4.3.5: deleted files drop their keys. Each dropped key lends its
// count so a pure rename can move it (same normalised content, same count).
function droppedCounts(
	baseline: Readonly<Record<string, number>>,
	current: Readonly<Record<string, number>>,
): Map<number, number> {
	const dropped = new Map<number, number>();
	for (const key of Object.keys(baseline).sort()) {
		if (Object.hasOwn(current, key)) {
			continue;
		}
		const before = baseline[key] ?? 0;
		if (before > 0) {
			dropped.set(before, (dropped.get(before) ?? 0) + 1);
		}
	}
	return dropped;
}

// SPEC §4.3.5: a key absent from the baseline with a count above zero is a
// candidate block.
function keysAbsentFromBaseline(
	baseline: Readonly<Record<string, number>>,
	current: Readonly<Record<string, number>>,
): Array<CountEntry> {
	const added: Array<CountEntry> = [];
	for (const key of Object.keys(current).sort()) {
		if (Object.hasOwn(baseline, key)) {
			continue;
		}
		const count = current[key] ?? 0;
		if (count > 0) {
			added.push({ key, count });
		}
	}
	return added;
}

// SPEC §4.3.5: ratchet comparison against the baseline. A pure rename (same
// normalised content) moves its keys and is not touched, so each dropped
// key cancels one added key with the same count; count equality is the only
// move signal this pure comparison has. Every other added key blocks.
export function compareRatchet(
	baseline: Readonly<Record<string, number>>,
	current: Readonly<Record<string, number>>,
): ReadonlyArray<string> {
	const violations = keysAboveBaseline(baseline, current);
	const dropped = droppedCounts(baseline, current);
	for (const entry of keysAbsentFromBaseline(baseline, current)) {
		const spare = dropped.get(entry.count) ?? 0;
		if (spare > 0) {
			dropped.set(entry.count, spare - 1);
			continue;
		}
		violations.push(entry.key);
	}
	return violations.sort();
}
