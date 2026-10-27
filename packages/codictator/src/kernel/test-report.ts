// SPEC §4.1.2: minimal reader for JUnit XML and TRX so red and green
// proofs need no runner-specific parsing (SPEC §4.10.2). No XML library is
// used; the reader matches only the elements it owns and fails closed on
// anything else.
import { makeError } from "./errors.ts";
import { err, ok, type Result } from "./result.ts";

export interface TestCaseResult {
	readonly id: string;
	readonly title: string;
	readonly outcome: "passed" | "failed" | "skipped";
}

function malformed(): Result<Array<TestCaseResult>> {
	return err(
		makeError(
			"CDX-E101",
			"test report XML is unparseable",
			"Regenerate the report as JUnit or TRX XML, then retry.",
		),
	);
}

function decodeEntities(text: string): string {
	return text
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");
}

function attributes(tag: string): ReadonlyMap<string, string> {
	const found = new Map<string, string>();
	const pattern = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
	let match = pattern.exec(tag);
	while (match !== null) {
		const name = match[1] ?? "";
		const value = match[3] ?? match[4] ?? "";
		if (!found.has(name)) {
			found.set(name, decodeEntities(value));
		}
		match = pattern.exec(tag);
	}
	return found;
}

function junitOutcome(inner: string): "passed" | "failed" | "skipped" {
	if (/<skipped(?:[\s>/])/.test(inner)) {
		return "skipped";
	}
	if (/<failure(?:[\s>/])/.test(inner) || /<error(?:[\s>/])/.test(inner)) {
		return "failed";
	}
	return "passed";
}

function readJUnit(xml: string): Array<TestCaseResult> {
	const cases: Array<TestCaseResult> = [];
	const selfClosed = /<testcase\b([^>]*?)\/>/g;
	for (const match of xml.matchAll(selfClosed)) {
		const attrs = attributes(match[1] ?? "");
		const name = attrs.get("name") ?? "";
		const classname = attrs.get("classname") ?? "";
		cases.push({
			id: classname === "" ? name : `${classname}#${name}`,
			title: name,
			outcome: "passed",
		});
	}
	const stripped = xml.replace(selfClosed, "");
	const paired = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>/g;
	for (const match of stripped.matchAll(paired)) {
		const attrs = attributes(match[1] ?? "");
		const name = attrs.get("name") ?? "";
		const classname = attrs.get("classname") ?? "";
		cases.push({
			id: classname === "" ? name : `${classname}#${name}`,
			title: name,
			outcome: junitOutcome(match[2] ?? ""),
		});
	}
	return cases;
}

function trxOutcome(raw: string): "passed" | "failed" | "skipped" | undefined {
	const outcome = raw.toLowerCase();
	if (outcome === "passed") {
		return "passed";
	}
	if (outcome === "failed") {
		return "failed";
	}
	if (outcome === "skipped" || outcome === "notexecuted") {
		return "skipped";
	}
	return undefined;
}

function readTrx(xml: string): Array<TestCaseResult> | undefined {
	if (!/<TestRun\b/.test(xml)) {
		return undefined;
	}
	const cases: Array<TestCaseResult> = [];
	const pattern = /<UnitTestResult\b([^>]*?)\/>/g;
	for (const match of xml.matchAll(pattern)) {
		const attrs = attributes(match[1] ?? "");
		const name = attrs.get("testName") ?? "";
		const id = attrs.get("testId") ?? name;
		const outcome = trxOutcome(attrs.get("outcome") ?? "");
		if (outcome === undefined) {
			return undefined;
		}
		cases.push({ id, title: name, outcome });
	}
	return cases;
}

export function readTestReport(xml: string): Result<Array<TestCaseResult>> {
	const text = xml.trim();
	if (text === "") {
		return malformed();
	}
	const trx = readTrx(text);
	if (trx !== undefined) {
		return ok(trx);
	}
	if (!/<testsuite\b/.test(text) && !/<testsuites\b/.test(text)) {
		return malformed();
	}
	return ok(readJUnit(text));
}
