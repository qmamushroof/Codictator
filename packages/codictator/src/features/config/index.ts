// SPEC §4.2: config load, validate, tighten. Owns the §7.2 format.

import type { Fs, Ports } from "../../kernel/index.ts";
import {
	makeError,
	NodeEnv,
	NodeFs,
	NodeGit,
	NodeNet,
	NodeProc,
	normalizeText,
	parseJson,
	SystemClock,
	sha256Text,
	stableStringify,
} from "../../kernel/index.ts";
import { checkAgentMarkers } from "./human.ts";
import { validateConfigValue } from "./validate.ts";

export { checkAgentMarkers, HOOK_MARKER, requireHuman } from "./human.ts";

export interface ConfigTunable {
	readonly params: Readonly<Record<string, unknown>>;
}

export interface Config {
	readonly version: 1;
	readonly codictator: string;
	readonly packs: ReadonlyArray<{
		readonly id: string;
		readonly version?: string;
		readonly path?: string;
	}>;
	readonly harnesses: ReadonlyArray<string>;
	readonly tunables: Readonly<Record<string, ConfigTunable>>;
	readonly architecture?: unknown;
	readonly workflow?: unknown;
	readonly spec?: unknown;
	readonly testing?: unknown;
	readonly commands?: Readonly<Record<string, ReadonlyArray<string>>>;
	readonly steering?: unknown;
	readonly tools?: ReadonlyArray<unknown>;
	readonly security?: unknown;
	readonly deps?: unknown;
	readonly network?: unknown;
	readonly integrity?: unknown;
	readonly ci?: unknown;
	readonly llm?: unknown;
}

export interface EffectiveConfig {
	readonly config: Config;
	readonly configHash: string;
}

// Mirrors packages/codictator/package.json version. The CLI passes the real
// installed version when it can read its own manifest; tests pin "0.0.0".
export const ENGINE_VERSION = "0.0.0";

const CONFIG_REL = ".codictator/config.json";

// Manifest names that mark a directory a repo without Codictator config.
const MANIFEST_FILES: ReadonlyArray<string> = [
	"package.json",
	"pyproject.toml",
	"setup.py",
	"setup.cfg",
	"requirements.txt",
	"Cargo.toml",
	"go.mod",
	"pom.xml",
	"build.gradle",
	"build.gradle.kts",
	"composer.json",
	"Gemfile",
	"Package.swift",
	"pubspec.yaml",
	"deno.json",
	"deno.jsonc",
];

const MANIFEST_GLOBS: ReadonlyArray<string> = ["*.sln", "*.csproj", "*.fsproj"];

function cleanRoot(repoRoot: string): string {
	const stripped = repoRoot.replace(/\/+$/, "");
	return stripped === "" ? "." : stripped;
}

function deepFreeze(value: unknown): void {
	if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
		return;
	}
	for (const entry of Object.values(value)) {
		deepFreeze(entry);
	}
	Object.freeze(value);
}

// SPEC §4.2.1 step 5: the frozen config hashed with the kernel canonical
// form, normalized first so CRLF-bearing values hash identically cross-OS
// (CONVENTIONS determinism). Every surface evaluates the same rule set.
export function configHashFor(config: Config): string {
	return sha256Text(normalizeText(stableStringify(config)));
}

function finishConfig(config: Config): EffectiveConfig {
	const frozen = structuredClone(config);
	deepFreeze(frozen);
	return { config: frozen, configHash: configHashFor(frozen) };
}

// SPEC §4.2.2: tunables tighten only; any loosening is an error.
export function validateConfig(value: unknown): EffectiveConfig {
	return finishConfig(validateConfigValue(value, ENGINE_VERSION));
}

async function findManifest(fs: Fs, root: string): Promise<string | undefined> {
	for (const name of MANIFEST_FILES) {
		const seen = await fs.exists(`${root}/${name}`);
		if (seen.ok && seen.value) {
			return name;
		}
	}
	for (const pattern of MANIFEST_GLOBS) {
		const found = await fs.glob(pattern, root);
		if (found.ok && found.value.length > 0) {
			return pattern;
		}
	}
	return undefined;
}

// SPEC §4.2.1: resolution order is the repo config file, validated in full.
// Ports are injected; without them the composition uses the live kernel
// ports rooted at repoRoot. Throws the CdxError its SPEC row owns.
export async function loadConfig(
	repoRoot: string,
	ports?: Ports,
): Promise<EffectiveConfig> {
	const root = cleanRoot(repoRoot);
	let active = ports;
	if (active === undefined) {
		const made = await NodeFs.create({ root });
		if (!made.ok) {
			throw makeError(
				"CDX-E108",
				`not a Codictator repo under ${root}: cannot resolve a repo root there`,
				"Run codictator init inside a repository to adopt it, or change into a Codictator repo.",
				made.error.message,
			);
		}
		const proc = new NodeProc();
		active = {
			fs: made.value,
			proc,
			net: new NodeNet(),
			clock: new SystemClock(),
			git: new NodeGit(proc, root),
			env: new NodeEnv(),
		};
	}
	// SPEC §4.2.4 EC-10: an agent-owned process never loads config.
	checkAgentMarkers(active.env);
	const configRel = `${root}/${CONFIG_REL}`;
	const seen = await active.fs.exists(configRel);
	if (!seen.ok) {
		throw makeError(
			"CDX-E101",
			`cannot read ${configRel}`,
			"Fix permissions on .codictator/config.json, then retry.",
			seen.error.message,
		);
	}
	if (!seen.value) {
		const manifest = await findManifest(active.fs, root);
		if (manifest !== undefined) {
			throw makeError(
				"CDX-E101",
				`${CONFIG_REL} is missing but ${manifest} exists`,
				"Run codictator init --repair to recreate the config.",
			);
		}
		throw makeError(
			"CDX-E108",
			`no ${CONFIG_REL} and no manifest under ${root}: not a Codictator repo`,
			"Run codictator init inside a repository to adopt it, or change into a Codictator repo.",
		);
	}
	const text = await active.fs.readText(configRel);
	if (!text.ok) {
		throw makeError(
			"CDX-E101",
			`${CONFIG_REL} is unreadable`,
			"Fix the file so it parses as JSON matching schema/config.schema.json, then retry.",
			text.error.message,
		);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		throw parsed.error;
	}
	// SPEC §3.3: config imports kernel only, so the CDX-E103 integrity event
	// the SPEC §4.2.4 EC-6 row pairs with the error is emitted by the caller
	// (engine or CLI), which may compose config with audit.
	return finishConfig(validateConfigValue(parsed.value, ENGINE_VERSION));
}
