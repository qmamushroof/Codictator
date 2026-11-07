// SPEC §4.20: the extension-host E2E suite. Runs inside VS Code via the
// E2E runner (extensionTestsPath): the host opens the tmp
// fixture repo, the scaffold asserts activation, the declared views and a
// live engine handshake, and records the versions it saw.
// Landed gates: PR1 cwd handshake (engine root equals the fixture folder)
// and the reply-level engineVersion (real version, never 0.0.0); PR2 ping
// and the watcher push (an external append reaches `events/appended` with
// no request in flight), plus the `events/tail` and L2 engine paths the
// Timeline and save flows read. Remaining gates wait on their engine or
// extension PR per the Roadmap 11 exit gate: views populate (PR3 producers
// plus a PR4 hook to observe them), save→L2 UI (PR4: registerL2OnSave is
// unwired and no DiagnosticCollection exists yet), kill→retrying→recover
// UI (PR1 reconnect plus a PR4 test hook to observe it), and no 0.0.0 in
// rules/list packs (PR3 versions).
import { strict as assert } from "node:assert";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";
import {
	openServeSession,
	probeEventLine,
} from "../../../scripts/serve-client.mjs";

const extensionId = "codictator.codictator-vscode";
const expectedViews = [
	"codictator-active-rules",
	"codictator-budget",
	"codictator-health",
	"codictator-steering",
	"codictator-timeline",
	"codictator-violations",
];

// The Roadmap 11 exit gate: an external append reaches the Timeline with
// no user action in under 3 s. The PR2 server polls every 1 s with a
// 150 ms debounce, so 3 s leaves headroom on loaded CI legs.
const PUSH_BUDGET_MS = 3_000;

function report(line) {
	process.stdout.write(`e2e: ${line}\n`);
}

function requiredEnv(name) {
	const value = process.env[name];
	assert.ok(
		typeof value === "string" && value !== "",
		`extension-host env ${name} is set`,
	);
	return value;
}

function readJson(path) {
	return JSON.parse(readFileSync(path, "utf8"));
}

// Windows drive letters disagree in case between the env record and the
// host uri; PR1 owns the shared samePath() helper, so the suite folds
// case on win32 only until then.
function sameFixturePath(left, right) {
	if (process.platform === "win32") {
		return left.toLowerCase() === right.toLowerCase();
	}
	return left === right;
}

function declaredViewIds(extension) {
	const contributes = extension.packageJSON?.contributes;
	const groups = contributes?.views;
	const container = groups?.Codictator;
	assert.ok(
		Array.isArray(container),
		`extension declares the Codictator views`,
	);
	return container.map((view) => view.id).sort();
}

export async function run() {
	const fixtureDir = requiredEnv("CODICTATOR_E2E_FIXTURE");
	const folders = vscode.workspace.workspaceFolders ?? [];
	assert.equal(folders.length, 1, `host opens exactly the fixture folder`);
	assert.ok(
		sameFixturePath(folders[0].uri.fsPath, fixtureDir),
		`host folder is the fixture`,
	);
	report(`host cwd: ${process.cwd()}`);
	report(`fixture: ${fixtureDir}`);

	const config = readJson(join(fixtureDir, ".codictator", "config.json"));
	assert.equal(config.version, 1, `fixture config is version 1`);
	const launcherPath = join(fixtureDir, ".codictator", "bin", "run.mjs");
	assert.equal(existsSync(launcherPath), true, `fixture ships run.mjs`);

	const extension = vscode.extensions.getExtension(extensionId);
	assert.ok(extension !== undefined, `extension ${extensionId} is installed`);
	await extension.activate();
	report(`extension active`);
	assert.deepEqual(declaredViewIds(extension), expectedViews);

	const session = openServeSession(launcherPath, fixtureDir);
	try {
		const init = await session.request("initialize", {});
		assert.equal(typeof init, "object", `engine answers an object`);
		assert.equal(init.protocolVersion, 1, `engine speaks protocol 1`);
		const linked = readJson(
			join(fixtureDir, "node_modules", "codictator", "package.json"),
		);
		assert.equal(
			typeof init.engineVersion,
			"string",
			`engine reports engineVersion`,
		);
		assert.notEqual(
			init.engineVersion,
			"0.0.0",
			`engine version is real, never 0.0.0`,
		);
		assert.equal(
			init.engineVersion,
			linked.version,
			`engine version matches the linked build`,
		);
		assert.ok(
			sameFixturePath(String(init.root), fixtureDir),
			`engine root is the fixture folder, not the host cwd`,
		);
		report(`engine root: ${String(init.root)}`);
		report(`engine version: ${String(init.engineVersion)}`);

		// PR2 liveness probe: ping answers without touching server state.
		const pong = await session.request("ping", {});
		assert.deepEqual(pong, { pong: true }, `ping answers pong`);
		report(`ping ok`);

		// PR2 watcher push: the ping above ran the after-request poll, so
		// the baseline is set with an empty log; the external append below
		// must surface as a push with no further request in flight.
		const probeId = `e2e-probe-${Date.now()}`;
		mkdirSync(join(fixtureDir, ".codictator", "state"), {
			recursive: true,
		});
		const appendedAt = Date.now();
		const push = session.waitNotification("events/appended", PUSH_BUDGET_MS);
		appendFileSync(
			join(fixtureDir, ".codictator", "state", "events.jsonl"),
			probeEventLine(probeId, linked.version),
		);
		const pushed = await push;
		const elapsedMs = Date.now() - appendedAt;
		assert.ok(
			elapsedMs < PUSH_BUDGET_MS,
			`external append pushes under 3 s (took ${elapsedMs} ms)`,
		);
		const pushedIds = Array.isArray(pushed?.events)
			? pushed.events.map((event) => event?.id)
			: [];
		assert.ok(pushedIds.includes(probeId), `push carries the appended event`);
		report(`external append pushed in ${elapsedMs} ms`);

		// The log path the Timeline view reads: the appended event pages.
		const tail = await session.request("events/tail", {});
		const tailIds = Array.isArray(tail?.events)
			? tail.events.map((event) => event?.id)
			: [];
		assert.ok(
			tailIds.includes(probeId),
			`events/tail pages the appended event`,
		);
		report(`events/tail ok`);

		// The L2 engine path the save flow verifies through: the fixture
		// answers a shape, never an error. The save→diagnostics UI itself
		// waits on PR4 (registerL2OnSave is unwired in activation and no
		// DiagnosticCollection exists yet).
		const l2 = await session.request("verify", {
			files: ["notes.txt"],
			layer: "L2",
		});
		assert.ok(
			l2?.verdict === "allow" || l2?.verdict === "block",
			`L2 verify answers a verdict`,
		);
		report(`L2 verdict on notes.txt: ${String(l2?.verdict)}`);

		// The rules path the Active rules view reads: packs load and every
		// rule names an id. Pack versions still ride the manifests until
		// the PR3 version stamp, so the suite reports them (TODO PR3).
		const listed = await session.request("rules/list", {});
		assert.ok(
			Array.isArray(listed?.rules) && listed.rules.length > 0,
			`rules/list answers rules`,
		);
		const packVersions = new Set(
			listed.rules.map((rule) => String(rule?.pack ?? "unknown")),
		);
		report(`rules/list packs: ${[...packVersions].sort().join(", ")}`);
	} finally {
		await session.close();
	}

	assert.notEqual(
		process.cwd(),
		fixtureDir,
		`host cwd stays elsewhere, never inside the fixture`,
	);
	for (const pack of config.packs) {
		assert.notEqual(pack.version, "0.0.0", `pack ${pack.id} is versioned`);
		assert.equal(
			pack.version,
			readJson(join(fixtureDir, "node_modules", "codictator", "package.json"))
				.version,
			`pack ${pack.id} matches the linked build`,
		);
	}
	const contributes = extension.packageJSON?.contributes ?? {};
	assert.ok(
		Array.isArray(contributes.commands) && contributes.commands.length > 0,
		`extension contributes palette commands`,
	);
	const welcomeIds = (contributes.viewsWelcome ?? []).map(
		(entry) => entry.view,
	);
	assert.deepEqual(welcomeIds.sort(), expectedViews);

	// TODO(PR3): assert no 0.0.0 in rules/list pack versions. The
	// reply-level engineVersion above is real; pack manifest versions are
	// still hard-coded until the PR3 version stamp.
	// TODO(PR3/PR4): assert every view populates. Needs PR1 labels plus
	// the PR3 real producers; view content is not reachable from the
	// vscode API without a PR4 test hook.
	// TODO(PR4): save notes.txt and assert L2 diagnostics refresh. The L2
	// engine path answers above, but registerL2OnSave is never wired into
	// activation and no vscode DiagnosticCollection exists yet, so the
	// host shows nothing to assert.
	// TODO(PR1/PR4): kill the engine child and assert the views show the
	// retrying state, then recover. The reconnect chain is wired (PR1),
	// but the suite cannot observe view state or address the extension's
	// engine child without a PR4 test hook (restart command or state
	// probe); a bare spawn/kill/respawn here would only test the server,
	// not the extension UI.
	report(`done`);
}
