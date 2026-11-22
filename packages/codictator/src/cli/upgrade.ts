// SPEC §4.19.8: moves the engine pin, config.codictator and the lockfile
// together, then regen and verify run under the new engine. The lookup
// and exec seams keep tests off the network; production omits them.
import path from "node:path";
import type { ProcOptions, ProcResult, Result } from "../kernel/index.ts";
import { ok } from "../kernel/index.ts";
import { looksLikeRegistryOutage, setupNpmArgv } from "./setup-install.ts";
import type { CommandRequest } from "./shared.ts";
import {
	fail,
	needRoot,
	portsFor,
	printHuman,
	printJson,
	readStateText,
	usageError,
	writeStateText,
} from "./shared.ts";
import type { UpgradePin, UpgradeSnapshot } from "./upgrade-pin.ts";
import {
	compareExact,
	configEdit,
	locateUpgradePin,
	parseExactVersion,
	pinEdit,
	restoreFiles,
	snapshotFiles,
} from "./upgrade-pin.ts";
import type { UpgradeRegistry } from "./upgrade-registry.ts";
import { liveLookup } from "./upgrade-registry.ts";

export const UPGRADE_USAGE = "usage: codictator upgrade [--to <version>]";

const CONFIG_REL = ".codictator/config.json";

export interface UpgradeDeps {
	readonly lookup?: () => Promise<Result<UpgradeRegistry>>;
	readonly exec?: (
		argv: ReadonlyArray<string>,
		options: ProcOptions,
	) => Promise<ProcResult>;
}

type Run = NonNullable<UpgradeDeps["exec"]>;

function parseTarget(
	args: ReadonlyArray<string>,
): { readonly to: string | undefined } | undefined {
	if (args.length === 0) {
		return { to: undefined };
	}
	if (args.length === 2 && args[0] === "--to" && args[1] !== undefined) {
		return { to: args[1] };
	}
	if (args.length === 1 && args[0]?.startsWith("--to=") === true) {
		return { to: args[0].slice("--to=".length) };
	}
	return undefined;
}

function refused<T>(req: CommandRequest, message: string): Result<T> {
	return fail<T>(
		"CDX-E012",
		message,
		"Pass an exact stable version at or above the pinned one, or omit --to for the npm latest.",
		req.json,
	);
}

// SPEC §4.19.8 steps 2 and 3: an exact --to is checked against the pin
// before any network use; the registry then confirms the target exists.
async function resolveTarget(
	req: CommandRequest,
	pin: UpgradePin,
	asked: string | undefined,
	lookup: () => Promise<Result<UpgradeRegistry>>,
): Promise<Result<string | undefined>> {
	const current = parseExactVersion(pin.version);
	if (current === undefined) {
		return fail<string | undefined>(
			"CDX-E101",
			`the engine pin ${pin.version} in ${pin.manifestRel} is not an exact version`,
			"Pin codictator to an exact version, then rerun codictator upgrade.",
			req.json,
		);
	}
	const wanted = asked === undefined ? undefined : parseExactVersion(asked);
	if (asked !== undefined && wanted === undefined) {
		return refused(req, `${asked} is not an exact stable version`);
	}
	if (wanted !== undefined && compareExact(wanted, current) <= 0) {
		return settle(req, pin, asked ?? "");
	}
	const found = await lookup();
	if (!found.ok) {
		return fail<string | undefined>(
			found.error.code,
			found.error.message,
			found.error.remediation,
			req.json,
		);
	}
	const target = asked ?? found.value.latest;
	if (!found.value.versions.includes(target)) {
		return refused(req, `${target} is not a published version of codictator`);
	}
	return settle(req, pin, target);
}

// Equal is a no-op (EC-17, undefined), lower is refused (EC-16), higher proceeds.
function settle(
	req: CommandRequest,
	pin: UpgradePin,
	target: string,
): Result<string | undefined> {
	const cmp = compareExact(
		parseExactVersion(target) ?? [0, 0, 0],
		parseExactVersion(pin.version) ?? [0, 0, 0],
	);
	if (cmp === 0) {
		printHuman(`upgrade: already at ${pin.version}`, req.quiet);
		return ok(undefined);
	}
	if (cmp < 0) {
		return refused(
			req,
			`${target} is older than the pinned engine ${pin.version}`,
		);
	}
	return ok(target);
}

async function runNpm(
	run: Run,
	root: string,
	pin: UpgradePin,
	subcommand: "install" | "ci",
): Promise<ProcResult> {
	const flags =
		subcommand === "install"
			? ["--package-lock-only", "--ignore-scripts"]
			: ["--ignore-scripts"];
	return run(
		[...setupNpmArgv(process.platform, process.execPath, subcommand), ...flags],
		{
			cwd: pin.dirRel === "." ? root : path.join(root, pin.dirRel),
			env: {},
			timeoutMs: 300000,
			maxOutputBytes: 4 * 1024 * 1024,
		},
	);
}

async function writeStep(
	req: CommandRequest,
	root: string,
	pin: UpgradePin,
	to: string,
	run: Run,
): Promise<Result<number>> {
	const snapshot = await snapshotFiles(root, [
		pin.manifestRel,
		CONFIG_REL,
		pin.lockRel,
	]);
	const manifest = snapshot.get(pin.manifestRel) ?? "";
	const config = snapshot.get(CONFIG_REL) ?? "";
	await writeStateText(root, pin.manifestRel, pinEdit(pin, manifest, to));
	await writeStateText(root, CONFIG_REL, configEdit(config, to));
	for (const subcommand of ["install", "ci"] as const) {
		const ran = await runNpm(run, root, pin, subcommand);
		if (ran.code !== 0 || ran.timedOut || ran.truncated) {
			return rollback(req, root, snapshot, ran);
		}
	}
	return ok(0);
}

async function rollback(
	req: CommandRequest,
	root: string,
	snapshot: UpgradeSnapshot,
	ran: ProcResult,
): Promise<Result<number>> {
	const restored = await restoreFiles(root, snapshot);
	const state = restored.ok
		? "the pin, config and lockfile are as they were"
		: "restoring them FAILED; run git checkout on the pin, config, lockfile";
	if (ran.timedOut || looksLikeRegistryOutage(`${ran.stdout}\n${ran.stderr}`)) {
		return fail(
			"CDX-E401",
			"registry or network unavailable during the upgrade install",
			`Retry with network access; ${state}.`,
			req.json,
		);
	}
	return fail(
		"CDX-E003",
		`npm failed during the upgrade install (exit ${String(ran.code)})`,
		`Run npm install in the directory owning the lockfile to see why; ${state}.`,
		req.json,
	);
}

// SPEC §4.19.8 steps 5 and 6: the new engine renders and judges the repo.
async function enginePasses(
	req: CommandRequest,
	root: string,
	pin: UpgradePin,
	run: Run,
	command: ReadonlyArray<string>,
): Promise<number> {
	const engine = path.join(
		root,
		pin.dirRel === "." ? "" : pin.dirRel,
		"node_modules",
		"codictator",
		"dist",
		"cli",
		"main.js",
	);
	const ran = await run([process.execPath, engine, ...command, "--cwd", root], {
		cwd: root,
		env: {},
		timeoutMs: 300000,
		maxOutputBytes: 4 * 1024 * 1024,
	});
	printHuman(ran.stdout.trimEnd(), req.quiet || ran.stdout === "");
	if (ran.stderr !== "") {
		process.stderr.write(ran.stderr);
	}
	return ran.timedOut || ran.truncated ? 1 : ran.code;
}

export async function handleUpgrade(
	req: CommandRequest,
	deps: UpgradeDeps = {},
): Promise<Result<number>> {
	const parsed = parseTarget(req.args);
	if (parsed === undefined) {
		return usageError(UPGRADE_USAGE);
	}
	const root = await needRoot(req);
	if (typeof root !== "string") {
		return root;
	}
	if ((await readStateText(root, CONFIG_REL)) === undefined) {
		return fail(
			"CDX-E108",
			"no .codictator/config.json here, so there is nothing to upgrade",
			"Run codictator setup to adopt this repo first.",
			req.json,
		);
	}
	const pin = await locateUpgradePin(root);
	if (pin === undefined) {
		return fail(
			"CDX-E003",
			"no engine pin at the root devDependencies or in .codictator/tool/package.json",
			"Run codictator setup to place the engine, then rerun codictator upgrade.",
			req.json,
		);
	}
	const target = await resolveTarget(
		req,
		pin,
		parsed.to,
		deps.lookup ?? (() => liveLookup(root)),
	);
	if (!target.ok) {
		return target;
	}
	if (target.value === undefined) {
		return ok(0);
	}
	const run: Run =
		deps.exec ??
		(async (argv, options) => {
			const ports = await portsFor(root);
			if (!ports.ok) {
				throw new Error(ports.error.message);
			}
			return ports.value.proc.run(argv, options);
		});
	const written = await writeStep(req, root, pin, target.value, run);
	if (!written.ok) {
		return written;
	}
	printHuman(`upgrade: ${pin.version} -> ${target.value}`, req.quiet);
	for (const command of [["regen"], ["verify", "--all"]]) {
		const code = await enginePasses(req, root, pin, run, command);
		if (code !== 0) {
			return ok(code);
		}
	}
	if (req.json) {
		printJson({ upgrade: true, from: pin.version, to: target.value });
	}
	return ok(0);
}
