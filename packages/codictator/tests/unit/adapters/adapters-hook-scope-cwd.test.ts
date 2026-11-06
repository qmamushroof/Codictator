// SPEC §4.7 EC-8: hookScope strips the caller-cwd root spelling without
// disk reads. Synthetic three-spelling mismatch only — no disk, no
// symlinks — so this passes headless everywhere.
import { strict as assert } from "node:assert";
import test from "node:test";
import type { HookEvent } from "../../../src/features/adapters/contract.ts";
import { hookScope } from "../../../src/features/adapters/hook-scope.ts";

const canonical = "/private/var/folders/xyz/repo";
const raw = "/var/folders/xyz/repo";
const cwdSpelling = "/cwd-spelling/repo";

function eventFor(target: string, command?: string): HookEvent {
	return {
		harness: "muse-code",
		event: "PreToolUse",
		trigger: "pre-tool",
		sessionId: "session-1",
		cwd: cwdSpelling,
		tool: {
			kind: "write",
			name: "write",
			paths: [target],
			...(command === undefined ? {} : { command }),
		},
	};
}

test("[§4.7 EC-8] hook scope strips the caller-cwd root spelling without disk reads", () => {
	const scope = hookScope(
		eventFor(`${cwdSpelling}/src/a.ts`),
		canonical,
		raw,
		cwdSpelling,
	);
	assert.deepEqual(scope.proposedPaths, ["src/a.ts"]);
});

test("[§4.7 EC-8] hook scope leaves out-of-root absolutes unchanged", () => {
	const scope = hookScope(
		eventFor("/elsewhere/b.ts"),
		canonical,
		raw,
		cwdSpelling,
	);
	assert.deepEqual(scope.proposedPaths, ["/elsewhere/b.ts"]);
});

test("[§4.7 EC-8] hook scope strips the cwd spelling in shell targets; pre-fix two-spelling call keeps it absolute", () => {
	const withFix = hookScope(
		eventFor("/elsewhere/keep.ts", `echo hi > ${cwdSpelling}/out.txt`),
		canonical,
		raw,
		cwdSpelling,
	);
	assert.ok(withFix.proposedPaths?.includes("out.txt"));
	const preFix = hookScope(eventFor(`${cwdSpelling}/src/a.ts`), canonical, raw);
	assert.deepEqual(preFix.proposedPaths, [`${cwdSpelling}/src/a.ts`]);
});
