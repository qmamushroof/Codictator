// SPEC §7.7: the bug registry grammar — title line, blank line, the exact
// header row and one row per defect in id order. Pure over caller-supplied
// text: base revisions arrive from the Git port at the enforcer layer,
// never from here.
import { normalizeText } from "../../kernel/index.ts";

export type BugStatus = "open" | "fixed" | "wontfix";

export interface BugRow {
	readonly id: string;
	readonly status: BugStatus;
	readonly title: string;
	readonly found: string;
	readonly fix: string;
	readonly regressionTest: string;
}

export interface BugFile {
	readonly year: string;
	readonly rows: ReadonlyArray<BugRow>;
}

const BUG_HEADER = "| Id | Status | Title | Found | Fix | Regression test |";
const BUG_SEPARATOR = "|---|---|---|---|---|---|";
const BUG_ID = /^BUG-(\d{4})$/;
const FOUND_CELL = /^(\d{4}-\d{2}-\d{2}), (T-\d{4}|none)$/;
const FIX_CELL = /^(T-\d{4}|none), (.+)$/;

function splitRow(line: string): Array<string> | undefined {
	const trimmed = line.trim();
	if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) {
		return undefined;
	}
	const cells: Array<string> = [];
	let current = "";
	let escaped = false;
	for (const char of trimmed.slice(1, -1)) {
		if (escaped) {
			current += char === "|" ? "|" : `\\${char}`;
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === "|") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += char;
	}
	cells.push(current.trim());
	return cells;
}

function toStatus(value: string): BugStatus | undefined {
	if (value === "open" || value === "fixed" || value === "wontfix") {
		return value;
	}
	return undefined;
}

// SPEC §7.7: the Bugs file holds its title line, a blank line, exactly the
// header row and one row per defect in id order.
export function parseBugFile(text: string): {
	readonly file: BugFile | undefined;
	readonly errors: ReadonlyArray<string>;
} {
	const errors: Array<string> = [];
	const lines = normalizeText(text).split("\n");
	const title = /^# Bugs — (\d{4})\s*$/.exec(lines[0]?.trim() ?? "");
	if (title === null) {
		return {
			file: undefined,
			errors: ["bug file misses its `# Bugs — <YYYY>` title line"],
		};
	}
	if ((lines[1] ?? "x").trim() !== "") {
		errors.push("bug file misses the blank line after its title");
	}
	if ((lines[2] ?? "").trim() !== BUG_HEADER) {
		errors.push("bug file misses exactly the specified header row");
	}
	if ((lines[3] ?? "").trim() !== BUG_SEPARATOR) {
		errors.push("bug file misses exactly the specified separator row");
	}
	const rows: Array<BugRow> = [];
	for (const line of lines.slice(4)) {
		if (line.trim() === "") {
			continue;
		}
		const cells = splitRow(line);
		if (cells === undefined || cells.length !== 6) {
			errors.push(`bug row outside the six-column grammar: "${line.trim()}"`);
			continue;
		}
		const status = toStatus(cells[1] ?? "");
		if (BUG_ID.exec(cells[0] ?? "") === null) {
			errors.push(`bug id outside BUG-####: "${cells[0] ?? ""}"`);
			continue;
		}
		if (status === undefined) {
			errors.push(`bug status outside open/fixed/wontfix: "${cells[1] ?? ""}"`);
			continue;
		}
		if (!FOUND_CELL.test(cells[3] ?? "")) {
			errors.push(
				`bug Found cell outside "<YYYY-MM-DD>, <T-#### or none>": "${cells[3] ?? ""}"`,
			);
			continue;
		}
		if (status === "open") {
			if ((cells[4] ?? "") !== "" || (cells[5] ?? "") !== "") {
				errors.push(
					`open bug row ${cells[0] ?? ""} fills Fix or Regression test`,
				);
				continue;
			}
		} else if (status === "fixed") {
			const fix = FIX_CELL.exec(cells[4] ?? "");
			if (fix === null || (fix[2] ?? "").trim() === "") {
				errors.push(
					`fixed bug row ${cells[0] ?? ""} misses its "<T-#### or none>, <subject>" Fix`,
				);
				continue;
			}
			if ((cells[5] ?? "").trim() === "") {
				errors.push(
					`fixed bug row ${cells[0] ?? ""} misses its regression test path`,
				);
				continue;
			}
		} else if ((cells[4] ?? "").trim().length < 20) {
			errors.push(
				`wontfix bug row ${cells[0] ?? ""} needs a reason of at least 20 characters`,
			);
			continue;
		}
		rows.push({
			id: cells[0] ?? "",
			status,
			title: cells[2] ?? "",
			found: cells[3] ?? "",
			fix: cells[4] ?? "",
			regressionTest: cells[5] ?? "",
		});
	}
	const ids = rows.map((row) => row.id);
	const sorted = [...ids].sort();
	if (ids.join("\n") !== sorted.join("\n")) {
		errors.push("bug rows outside id order");
	}
	return {
		file: { year: title[1] ?? "", rows },
		errors,
	};
}
