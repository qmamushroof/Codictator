// SPEC §4.2.1 step 3 + §4.4.4 + §4.4.8 EC-2..EC-4: the state of a custom
// pack config.packs names. Only a missing pack fails the load (CDX-E203).
// A pack that does not load, fails its self-test (L4 only) or no longer
// matches its accepted hash is inert: its rules do not run, and
// core/custom-pack-selftest blocks at L4. L1–L3 gate on the acceptance hash
// alone, so the hot path never runs fixtures.
import type {
	CdxError,
	Fs,
	Pack,
	PackManifest,
	Ports,
	Result,
} from "../../kernel/index.ts";
import { err, makeError, ok, parseJson } from "../../kernel/index.ts";
import { verifyAcceptance } from "./hashes.ts";
import { loadPack } from "./loader.ts";
import { readSchemaText } from "./loader-schema.ts";
import { field, isRecord } from "./manifest.ts";
import { customRoot } from "./roots.ts";
import { selfTest } from "./selftest.ts";

export type CustomPackState =
	| { readonly kind: "active"; readonly pack: Pack }
	| { readonly kind: "inert"; readonly dir: string; readonly error: CdxError };

const CONFIG_FILE = ".codictator/config.json";

// SPEC §3 + §7.2: a custom pack lives at the repo-relative `path` its
// config.packs entry names, else at `.codictator/packs/<id>/`.
async function packDir(fs: Fs, id: string): Promise<string> {
	const text = await fs.readText(CONFIG_FILE);
	const parsed = text.ok ? parseJson(text.value) : undefined;
	const packs =
		parsed?.ok === true && isRecord(parsed.value)
			? field(parsed.value, "packs")
			: undefined;
	for (const entry of Array.isArray(packs) ? packs : []) {
		if (isRecord(entry) && field(entry, "id") === id) {
			const root = customRoot(field(entry, "path"));
			if (root !== undefined && root !== "") {
				return root;
			}
		}
	}
	return `.codictator/packs/${id}`;
}

export async function customPackState(
	ports: Ports,
	id: string,
	selfTested: boolean,
): Promise<Result<CustomPackState>> {
	const dir = await packDir(ports.fs, id);
	const seen = await ports.fs.exists(`${dir}/pack.json`);
	if (!seen.ok) {
		return err(seen.error);
	}
	if (!seen.value) {
		return err(
			makeError(
				"CDX-E203",
				`configured pack "${id}" is missing: no ${dir}/pack.json`,
				"Install the pack under its config.packs path, or remove it from config.packs.",
			),
		);
	}
	const inert = (error: CdxError): Result<CustomPackState> =>
		ok({ kind: "inert", dir, error });
	const loaded = await loadPack(dir, { ports, skipAcceptance: true });
	if (!loaded.ok) {
		return inert(loaded.error);
	}
	if (selfTested) {
		const tested = await selfTest(loaded.value, { fs: ports.fs, dir });
		if (!tested.ok) {
			return inert(tested.error);
		}
	}
	const schema = await readSchemaText("accepted.schema.json");
	if (!schema.ok) {
		return err(schema.error);
	}
	const accepted = await verifyAcceptance(
		ports.fs,
		dir,
		loaded.value.manifest,
		schema.value,
	);
	return accepted.ok
		? ok({ kind: "active", pack: loaded.value })
		: inert(accepted.error);
}

// SPEC §4.4.3 step 1: custom packs load after the builtins, in
// config.packs order; inert ones contribute nothing.
export async function activeCustomManifests(
	ports: Ports,
	ids: ReadonlyArray<string>,
	selfTested: boolean,
): Promise<Result<Array<PackManifest>>> {
	const manifests: Array<PackManifest> = [];
	for (const id of ids) {
		const state = await customPackState(ports, id, selfTested);
		if (!state.ok) {
			return err(state.error);
		}
		if (state.value.kind === "active") {
			manifests.push(state.value.pack.manifest);
		}
	}
	return ok(manifests);
}
