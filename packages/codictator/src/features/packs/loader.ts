// SPEC §4.4.3: loading and composition. Reads pack.json (schema §7.3),
// applies the manifest checks, verifies custom-pack acceptance (§4.4.7),
// and resolves declared enforcers as deferred stubs that throw CDX-E901,
// so nothing silently passes until its owning module lands.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Fs, Ports, Result } from "../../kernel/index.ts";
import {
	err,
	makeError,
	NodeFs,
	ok,
	parseJson,
	stableStringify,
	validateSchema,
} from "../../kernel/index.ts";
import type { ExternalOptions, ToolDecl } from "./enforcers/external.ts";
import { narrowToolDecl } from "./enforcers/external-bind.ts";
import { verifyAcceptance } from "./hashes.ts";
import type { Pack, PackManifest } from "./index.ts";
import {
	checkPack,
	type EnforcerDecl,
	field,
	isBuiltinPackId,
	isRecord,
	narrowEnforcerDecl,
	narrowManifest,
} from "./manifest.ts";
import { livePorts, resolvePackEnforcers } from "./registry.ts";

export interface LoadPackOptions {
	readonly ports?: Ports;
	// Built-in packs carry a built-in id and skip the custom-pack prefix
	// checks; every other directory loads as a custom pack.
	readonly builtin?: boolean;
	// `pack accept` loads past the acceptance gate to re-accept an edit.
	readonly skipAcceptance?: boolean;
	// SPEC §4.4.5: config.tools rows bound to external enforcers. Entries
	// narrow at load (CDX-E203, CDX-E206); an enforcer naming an unbound
	// tool id resolves deferred until config binds it.
	readonly tools?: ReadonlyArray<unknown>;
	// SPEC §4.4.5 visibility: each tool run reports its event here when set.
	readonly onToolEvent?: ExternalOptions["onToolEvent"];
}

// SPEC §4.4.1: the owning pack's directory holds pack.json beside fixtures/.
function builtinPackDir(id: string): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "builtin-packs", id);
}

function packageSchemaDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "schema");
}

function toPosix(value: string): string {
	return value.split(path.sep).join("/");
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

// The shipped schemas carry `$schema` and `title`, which are metadata
// with no validation semantics in the kernel subset (§4.1.2). Stripping
// them keeps schema/ as the single owner of the format without touching
// the kernel for pack loading.
function stripSchemaMetadata(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => stripSchemaMetadata(entry));
	}
	if (isRecord(value)) {
		const kept: Record<string, unknown> = {};
		for (const key of Object.keys(value)) {
			if (key === "$schema" || key === "title") {
				continue;
			}
			kept[key] = stripSchemaMetadata(field(value, key));
		}
		return kept;
	}
	return value;
}

async function readSchemaText(name: string): Promise<Result<string>> {
	const absolute = path.join(packageSchemaDir(), name);
	const root = path.parse(absolute).root;
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return err(made.error);
	}
	const text = await made.value.readText(
		toPosix(path.relative(root, absolute)),
	);
	if (!text.ok) {
		return err(text.error);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	return ok(stableStringify(stripSchemaMetadata(parsed.value)));
}

// SPEC §4.4.3: load one pack directory (pack.json plus accepted.json).
export async function loadPack(
	packPath: string,
	options: LoadPackOptions = {},
): Promise<Result<Pack>> {
	const builtin = options.builtin ?? false;
	const resolved = path.resolve(packPath);
	// Injected ports read caller-form paths (the CLI passes repo-relative
	// ones); without ports the loader resolves against the cwd and reads
	// through a drive-rooted live port. The schema always ships with this
	// package, so it always reads through a live port.
	let fs: Fs;
	let at: (name: string) => string;
	let dirForm: string;
	if (options.ports !== undefined) {
		fs = options.ports.fs;
		const base = toPosix(packPath);
		at = (name: string): string => `${base}/${name}`;
		dirForm = base;
	} else {
		const root = path.parse(resolved).root;
		const made = await NodeFs.create({ root });
		if (!made.ok) {
			return err(made.error);
		}
		fs = made.value;
		at = (name: string): string =>
			toPosix(path.relative(root, path.join(resolved, name)));
		dirForm = toPosix(path.relative(root, resolved));
	}
	const seen = await fs.exists(at("pack.json"));
	if (!seen.ok) {
		return err(seen.error);
	}
	if (!seen.value) {
		return err(
			makeError(
				"CDX-E203",
				`no pack.json under ${resolved}: not a pack directory`,
				"Point the pack path at a directory holding pack.json (§4.4.1).",
			),
		);
	}
	const text = await fs.readText(at("pack.json"));
	if (!text.ok) {
		return err(text.error);
	}
	const schemaText = await readSchemaText("pack.schema.json");
	if (!schemaText.ok) {
		return err(schemaText.error);
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return err(parsed.error);
	}
	const schemaChecked = validateSchema(schemaText.value, parsed.value);
	if (!schemaChecked.ok) {
		return err(schemaChecked.error);
	}
	const narrowed = narrowManifest(parsed.value);
	if (!narrowed.ok) {
		return err(narrowed.error);
	}
	const manifest: PackManifest = narrowed.value;
	const checked = checkPack(manifest, builtin);
	if (!checked.ok) {
		return err(checked.error);
	}
	if (!(options.skipAcceptance ?? false)) {
		const acceptedSchemaText = await readSchemaText("accepted.schema.json");
		if (!acceptedSchemaText.ok) {
			return err(acceptedSchemaText.error);
		}
		const accepted = await verifyAcceptance(
			fs,
			dirForm,
			manifest,
			acceptedSchemaText.value,
		);
		if (!accepted.ok) {
			return err(accepted.error);
		}
	}
	const decls: Array<EnforcerDecl> = [];
	for (const entry of manifest.enforcers) {
		const narrowedDecl = narrowEnforcerDecl(entry);
		if (!narrowedDecl.ok) {
			return err(narrowedDecl.error);
		}
		decls.push(narrowedDecl.value);
	}
	decls.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const tools: Array<ToolDecl> = [];
	for (const entry of options.tools ?? []) {
		const narrowedTool = narrowToolDecl(entry);
		if (!narrowedTool.ok) {
			return err(narrowedTool.error);
		}
		tools.push(narrowedTool.value);
	}
	let enforcerPorts: Ports;
	if (options.ports !== undefined) {
		enforcerPorts = options.ports;
	} else {
		const live = await livePorts(path.parse(resolved).root);
		if (!live.ok) {
			return err(live.error);
		}
		enforcerPorts = live.value;
	}
	const externalOptions =
		options.onToolEvent === undefined
			? {}
			: { onToolEvent: options.onToolEvent };
	const enforcers = resolvePackEnforcers(
		manifest,
		decls,
		enforcerPorts,
		tools,
		externalOptions,
	);
	if (!enforcers.ok) {
		return err(enforcers.error);
	}
	deepFreeze(manifest);
	return ok({
		manifest,
		enforcers: enforcers.value,
		drivers: manifest.drivers,
		assets: manifest.assets,
	});
}

// SPEC §4.4.2: load a built-in pack by id from its own directory.
export function loadBuiltinPack(
	id: string,
	options: LoadPackOptions = {},
): Promise<Result<Pack>> {
	if (!isBuiltinPackId(id)) {
		return Promise.resolve(
			err(
				makeError(
					"CDX-E203",
					`unknown built-in pack id "${id}"`,
					"Load core, typescript, dotnet or python.",
				),
			),
		);
	}
	return loadPack(builtinPackDir(id), { ...options, builtin: true });
}

// SPEC §4.4.3 steps 1–2 and 5: packs arrive in load order (core, language
// packs in config.packs order, custom packs); rule ids must be globally
// unique across them (CDX-E202). Extractor overlap reporting is status
// output (SPEC §4.4.8 EC-13) and lands with the CLI.
export function composePacks(
	packs: ReadonlyArray<Pack>,
): Result<ReadonlyArray<Pack>> {
	const owners = new Map<string, string>();
	for (const pack of packs) {
		for (const rule of pack.manifest.rules) {
			const owner = owners.get(rule.id);
			if (owner !== undefined) {
				return err(
					makeError(
						"CDX-E202",
						`duplicate rule id "${rule.id}" in packs "${owner}" and "${pack.manifest.id}"`,
						"Keep rule ids globally unique across composed packs, then reload.",
					),
				);
			}
			owners.set(rule.id, pack.manifest.id);
		}
	}
	return ok([...packs]);
}
