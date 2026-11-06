// SPEC §4.19.4 + §4.19.6 steps 4-5: the engine install layout and the
// clean install here. npm repos install at the root; other repos get
// .codictator/tool/package.json pinning the engine exactly, then npm ci
// runs in the directory owning the lockfile. Placing the tool manifest
// and generating its lockfile mutate the repo and need the network, so
// both wait for an explicit TTY yes; anything else fails closed with
// CDX-E003. A registry or network outage maps to CDX-E401 (exit 5); any
// other install failure is a missing engine, CDX-E003 (exit 6).
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { ENGINE_VERSION } from "../features/config/index.ts";
import type { ProcOptions, ProcResult, Result } from "../kernel/index.ts";
import { err, ok, stableStringify } from "../kernel/index.ts";
import type { SetupStep } from "./setup.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	isTty,
	portsFor,
	printHuman,
	readStateText,
	writeStateText,
} from "./shared.ts";

export interface SetupInstallTarget {
	readonly dir: string;
	readonly lockRel: string;
	readonly dirRel: string;
}

// SPEC §4.19.6: the test seams for the consent gate. isTty answers the
// TTY check; prompt stands in for the TTY read, so quiet tests assert the
// exact visible message without touching stdin; run stands in for the npm
// spawn, so no test touches the network. Production callers omit all three.
export interface SetupInstallDeps {
	readonly isTty?: () => boolean;
	readonly prompt?: (message: string) => Promise<string>;
	readonly run?: (
		argv: ReadonlyArray<string>,
		options: ProcOptions,
	) => Promise<ProcResult>;
}

// SPEC §4.19.6: the production prompt. The message rides as the
// question() prompt so the TTY shows the exact mutation before the cursor
// waits; a bare question("") would leave the consent line invisible.
async function defaultPrompt(message: string): Promise<string> {
	const line = createInterface({
		input: process.stdin,
		output: process.stdout,
	});
	try {
		return await line.question(`${message} `);
	} finally {
		line.close();
	}
}

// SPEC §4.19.6: the tool-scope consent gate. The prompt names the missing
// artifact, the directory and the exact command; only y/yes counts as
// consent, everything else fails closed. Tests answer through
// req.stdinText (the runCommand seam) or the prompt seam; production reads
// one TTY line through defaultPrompt, so quiet tests never print and never
// block.
async function askInstallConsent(
	req: CommandRequest,
	message: string,
	prompt: (message: string) => Promise<string>,
): Promise<boolean> {
	const firstLine = req.stdinText?.split("\n")[0] ?? "";
	if (req.stdinText !== undefined) {
		return /^\s*y(es)?\s*$/i.test(firstLine);
	}
	return /^\s*y(es)?\s*$/i.test(await prompt(message));
}

function missingLockfile(
	req: CommandRequest,
	target: SetupInstallTarget,
): Result<number> {
	return fail(
		"CDX-E003",
		`no lockfile at ${target.lockRel}, so npm ci cannot run`,
		`Run npm install in ${target.dirRel} (needs network access), then rerun codictator setup.`,
		req.json,
	);
}

export async function setupInstallLayout(
	req: CommandRequest,
	root: string,
	steps: Array<SetupStep>,
	deps: SetupInstallDeps = {},
): Promise<Result<SetupInstallTarget>> {
	const rootManifest = await readStateText(root, "package.json");
	if (rootManifest !== undefined) {
		steps.push({ step: "install", ok: true, detail: { dir: "." } });
		return ok({ dir: root, lockRel: "package-lock.json", dirRel: "." });
	}
	const toolManifest = await readStateText(
		root,
		".codictator/tool/package.json",
	);
	if (toolManifest === undefined) {
		// SPEC §4.19.6: placing the manifest mutates the repo, so it waits
		// for the same consent as the install it enables.
		const tty = deps.isTty ?? isTty;
		const agreed =
			tty() &&
			(await askInstallConsent(
				req,
				`setup: missing .codictator/tool/package.json - write it in .codictator/tool? [y/n]`,
				deps.prompt ?? defaultPrompt,
			));
		if (!agreed) {
			return fail(
				"CDX-E003",
				"no manifest at .codictator/tool/package.json, so the engine cannot be placed",
				"Rerun codictator setup and consent to the tool install (needs network access).",
				req.json,
			);
		}
		const engineVersion = req.engineVersion ?? ENGINE_VERSION;
		const saved = await writeStateText(
			root,
			".codictator/tool/package.json",
			`${stableStringify({
				name: "codictator-tool",
				private: true,
				dependencies: { codictator: engineVersion },
			})}\n`,
		);
		if (!saved.ok) {
			return err(saved.error);
		}
	}
	steps.push({
		step: "install",
		ok: true,
		detail: { dir: ".codictator/tool" },
	});
	return ok({
		dir: `${root}/.codictator/tool`,
		lockRel: ".codictator/tool/package-lock.json",
		dirRel: ".codictator/tool",
	});
}

function looksLikeRegistryOutage(output: string): boolean {
	return /ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|ECONNREFUSED|registry/i.test(
		output,
	);
}

// SPEC §4.1.1: the child spawns with shell:false always, so on win32 the
// bare `npm` shim never resolves: it is an npm.cmd batch file, which the
// shell-less spawn cannot execute (ENOENT without, EINVAL with, the
// extension). The fix stays shell-free by exec'ing the real entry beside
// the running node: node <node-dir>/node_modules/npm/bin/npm-cli.js ci.
// POSIX keeps `npm` from PATH. Pure in platform and execPath so tests pin
// the exact proc argv without spawning anything.
export function setupNpmArgv(
	platform: string = process.platform,
	execPath: string = process.execPath,
	subcommand: "ci" | "install" = "ci",
): ReadonlyArray<string> {
	if (platform !== "win32") {
		return ["npm", subcommand];
	}
	return [
		execPath,
		path.join(
			path.dirname(execPath),
			"node_modules",
			"npm",
			"bin",
			"npm-cli.js",
		),
		subcommand,
	];
}

async function runNpmSubcommand(
	req: CommandRequest,
	root: string,
	target: SetupInstallTarget,
	subcommand: "ci" | "install",
	steps: Array<SetupStep>,
	deps: SetupInstallDeps,
): Promise<Result<number>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return fail(
			"CDX-E903",
			ports.error.message,
			ports.error.remediation,
			req.json,
		);
	}
	const run =
		deps.run ??
		((argv: ReadonlyArray<string>, options: ProcOptions): Promise<ProcResult> =>
			ports.value.proc.run(argv, options));
	const ran = await run(
		setupNpmArgv(process.platform, process.execPath, subcommand),
		{
			cwd: target.dir,
			env: {},
			timeoutMs: 300000,
			maxOutputBytes: 4 * 1024 * 1024,
		},
	);
	if (!ran.timedOut && !ran.truncated && ran.code === 0) {
		steps.push(
			subcommand === "ci"
				? { step: "install-here", ok: true }
				: {
						step: "install",
						ok: true,
						detail: { dir: target.dirRel, command: "npm install" },
					},
		);
		printHuman(
			`setup: npm ${subcommand} passed in ${target.dirRel}`,
			req.quiet,
		);
		return ok(0);
	}
	if (ran.timedOut || looksLikeRegistryOutage(`${ran.stdout}\n${ran.stderr}`)) {
		return fail(
			"CDX-E401",
			"registry or network unavailable during install",
			"Retry with network access, then rerun codictator setup.",
			req.json,
		);
	}
	return fail(
		"CDX-E003",
		`engine install failed in ${target.dirRel} (npm ${subcommand} exit ${String(ran.code)})`,
		`Run npm ${subcommand} in ${target.dirRel}, then rerun codictator setup.`,
		req.json,
	);
}

export async function setupInstallHere(
	req: CommandRequest,
	root: string,
	target: SetupInstallTarget,
	steps: Array<SetupStep>,
	deps: SetupInstallDeps = {},
): Promise<Result<number>> {
	const lock = await readStateText(root, target.lockRel);
	if (lock === undefined) {
		if (target.dirRel === ".") {
			return missingLockfile(req, target);
		}
		// SPEC §4.19.6: generating the tool lockfile mutates the repo and
		// needs the network, so a TTY human confirms the exact commands;
		// a decline or a non-TTY run fails closed with the current E003,
		// unmutated and unprompted.
		const tty = deps.isTty ?? isTty;
		const agreed =
			tty() &&
			(await askInstallConsent(
				req,
				`setup: missing ${target.lockRel} - run "npm install" then "npm ci" in ${target.dirRel}? [y/n]`,
				deps.prompt ?? defaultPrompt,
			));
		if (!agreed) {
			return missingLockfile(req, target);
		}
		const generated = await runNpmSubcommand(
			req,
			root,
			target,
			"install",
			steps,
			deps,
		);
		if (!generated.ok) {
			return generated;
		}
	}
	return runNpmSubcommand(req, root, target, "ci", steps, deps);
}
