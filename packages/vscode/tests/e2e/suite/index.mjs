// SPEC §4.20: the extension-host E2E suite. Runs inside VS Code via the
// E2E runner (extensionTestsPath): the host opens the tmp
// fixture repo, the scaffold asserts activation, the declared views and a
// live engine handshake, and records the versions it saw.
// View-population, live-refresh, diagnostics, reconnect and no-0.0.0
// asserts wait on PRs 1-3 per the Roadmap 11 exit gate.
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
// Resolves the result payload of the first JSON-RPC reply.
function initializeOnce(launcherPath) {
	return new Promise((resolvePromise, rejectPromise) => {
		const child = spawn("node", [launcherPath, "serve", "--stdio"], {
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

	const raw = await initializeOnce(launcherPath);
	const reply = JSON.parse(raw);
	assert.equal(reply.id, 1, `engine answers the initialize id`);
	assert.ok(reply.result !== undefined, `engine answers a result`);
	assert.equal(reply.result.protocolVersion, 1, `engine speaks protocol 1`);
	report(`engine root: ${String(reply.result.root)}`);
	report(`engine version: ${String(reply.result.version)}`);

	const linked = readJson(
		join(fixtureDir, "node_modules", "codictator", "package.json"),
	);
	assert.notEqual(linked.version, "0.0.0", `linked engine is versioned`);
	report(`done`);
}
