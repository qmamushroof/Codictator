// SPEC §4.20: the extension-host E2E suite. Runs inside VS Code via the
// E2E runner (extensionTestsPath): the host opens the tmp
// fixture repo, the scaffold asserts activation, the declared views and a
// live engine handshake, and records the versions it saw.
// Landed gates: PR1 cwd handshake (engine root equals the fixture folder)
// and the reply-level engineVersion (real version, never 0.0.0).
// Remaining gates wait on their engine or extension PR per the Roadmap 11
// exit gate: views populate (PR1 labels, PR3 producers), external append
// under 3 s (PR2 watcher), save→L2 (PR1 paths, PR2 refresh),
// kill→retrying→recover UI (PR1 reconnect plus a PR4 test hook to observe
// it), and no 0.0.0 in rules/list packs (PR3 versions).
import { strict as assert } from "node:assert";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as vscode from "vscode";

const extensionId = "codictator.codictator-vscode";
const expectedViews = [
	"codictator-active-rules",
	"codictator-budget",
	"codictator-health",
	"codictator-steering",
	"codictator-timeline",
	"codictator-violations",
];

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

// One initialize round-trip against the fixture launcher over stdio.
// Spawns with the fixture folder as cwd, the same shape as the PR1
// extension spawn, so the D1 gate holds: the engine must resolve the
// fixture folder as its root, not the host cwd. Resolves the result
// payload of the first JSON-RPC reply.
function initializeOnce(launcherPath, cwd) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn("node", [launcherPath, "serve", "--stdio"], {
			cwd,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let buffered = "";
		const done = (outcome) => {
			child.kill();
			if (outcome.ok) {
				resolvePromise(outcome.value);
			} else {
				rejectPromise(outcome.error);
			}
		};
		const guard = setTimeout(() => {
			done({ error: new Error(`engine initialize timed out`), ok: false });
		}, 30_000);
		child.on("error", (error) => {
			clearTimeout(guard);
			done({ error, ok: false });
		});
		child.stdout.on("data", (chunk) => {
			buffered += String(chunk);
			const newline = buffered.indexOf("\n");
			if (newline < 0) {
				return;
			}
			clearTimeout(guard);
			done({ ok: true, value: buffered.slice(0, newline) });
		});
		child.stdin.write(
			`${JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: {} })}\n`,
		);
	});
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

	const raw = await initializeOnce(launcherPath, fixtureDir);
	const reply = JSON.parse(raw);
	assert.equal(reply.id, 1, `engine answers the initialize id`);
	assert.ok(reply.result !== undefined, `engine answers a result`);
	assert.equal(reply.result.protocolVersion, 1, `engine speaks protocol 1`);
	const linked = readJson(
		join(fixtureDir, "node_modules", "codictator", "package.json"),
	);
	assert.equal(
		typeof reply.result.engineVersion,
		"string",
		`engine reports engineVersion`,
	);
	assert.notEqual(
		reply.result.engineVersion,
		"0.0.0",
		`engine version is real, never 0.0.0`,
	);
	assert.equal(
		reply.result.engineVersion,
		linked.version,
		`engine version matches the linked build`,
	);
	assert.ok(
		sameFixturePath(String(reply.result.root), fixtureDir),
		`engine root is the fixture folder, not the host cwd`,
	);
	report(`engine root: ${String(reply.result.root)}`);
	report(`engine version: ${String(reply.result.engineVersion)}`);

	// TODO(PR2): append an event externally and assert the Timeline view
	// updates within 3 s with no user action. Needs the serve-side
	// events/appended push plus the extension refresh wiring.
	// TODO(PR2): save notes.txt and assert L2 diagnostics refresh.
	// Needs the PR2 selective refresh on top of the PR1 path matching.
	// TODO(PR1/PR4): kill the engine child and assert the views show the
	// retrying state, then recover. The reconnect chain is wired (PR1),
	// but the suite cannot observe view state or address the extension's
	// engine child without a PR4 test hook (restart command or state
	// probe); a bare spawn/kill/respawn here would only test the server,
	// not the extension UI.
	// TODO(PR3): assert no 0.0.0 anywhere in rules/list pack versions.
	// The reply-level engineVersion above is real; pack manifest versions
	// are still hard-coded until the PR3 version stamp.
	// TODO(PR1/PR3): assert every view populates. Needs PR1 labels plus
	// the PR3 real producers; view content is not reachable from the
	// vscode API without a PR4 test hook.
	report(`done`);
}
