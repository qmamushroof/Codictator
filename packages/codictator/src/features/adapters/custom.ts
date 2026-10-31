// SPEC §4.5.6: custom adapter contract surface. Renders every configured
// custom adapter's files through its own render for regen, and checks the
// adapter contract against the adapter's shipped goldens for
// `adapter test`. Loading, payload narrowing and the Adapter seam live in
// custom-load.ts, custom-event.ts and custom-shape.ts; this file owns the
// contract checks and keeps the original barrel path, so existing imports
// of loadCustomAdapter keep working.
import type { Fs, Result } from "../../kernel/index.ts";
import { err, NodeFs, ok, parseJson } from "../../kernel/index.ts";
import type { Adapter, FileArtifact, RenderInput } from "./contract.ts";
import { loadCustomAdapter } from "./custom-load.ts";
import {
	ADAPTER_BASE,
	CUSTOM_PREFIX,
	field,
	fullIdOf,
	isRecord,
	noContract,
} from "./custom-shape.ts";

export { loadCustomAdapter };

function regenInput(fullId: string, root: string): RenderInput {
	return {
		event: {
			harness: fullId,
			event: "session.start",
			trigger: "startup",
			sessionId: "regen",
			cwd: root,
		},
		decision: { decision: "allow", eventId: "regen" },
	};
}

// SPEC §4.5.6 + §4.5.8 EC-12: regen renders every configured custom
// adapter's files through its own render; a load or render failure fails
// closed with the loader's code, and unchanged config reproduces the
// files byte for byte.
export async function renderCustomHarnessFiles(
	root: string,
	harnesses: ReadonlyArray<string>,
): Promise<Result<Array<FileArtifact>>> {
	const ids = [...new Set(harnesses)]
		.filter((harness) => harness.startsWith(CUSTOM_PREFIX))
		.sort();
	const files: Array<FileArtifact> = [];
	for (const full of ids) {
		const loaded = await loadCustomAdapter(
			root,
			full.slice(CUSTOM_PREFIX.length),
		);
		if (!loaded.ok) {
			return err(loaded.error);
		}
		let artifacts: Array<FileArtifact>;
		try {
			artifacts = loaded.value.render(regenInput(full, root));
		} catch {
			return err(noContract(full, "render threw during regen"));
		}
		for (const artifact of artifacts) {
			files.push(artifact);
		}
	}
	return ok(files);
}

// SPEC §4.5.6: the custom-regen fragment for handleRegen. Every configured
// custom adapter renders its own files through its render; a load or
// render failure fails closed here, so a broken custom adapter never
// regens half a repo.
export async function renderCustomRegenFragment(
	root: string,
	configured: { readonly harnesses: ReadonlyArray<string> },
): Promise<Result<Array<FileArtifact>>> {
	return renderCustomHarnessFiles(root, configured.harnesses);
}

async function readGoldenJson(
	fs: Fs,
	fullId: string,
	relative: string,
): Promise<Result<unknown>> {
	const text = await fs.readText(relative);
	if (!text.ok) {
		return err(noContract(fullId, `missing golden ${relative}`));
	}
	const parsed = parseJson(text.value);
	if (!parsed.ok) {
		return err(noContract(fullId, `unparseable golden ${relative}`));
	}
	return ok(parsed.value);
}

// SPEC §4.5.6: `adapter test <custom id>` runs the adapter against its own
// shipped goldens (golden parse, golden render byte for byte, reply shape
// smoke). Any gap is CDX-E302: the adapter stays inert until it verifies.
export async function checkCustomContract(
	root: string,
	id: string,
): Promise<Result<Adapter>> {
	const loaded = await loadCustomAdapter(root, id);
	if (!loaded.ok) {
		return loaded;
	}
	const adapter = loaded.value;
	const fullId = fullIdOf(id);
	const made = await NodeFs.create({ root });
	if (!made.ok) {
		return err(made.error);
	}
	const fs = made.value;
	const dir = `${ADAPTER_BASE}/${id}`;
	const envelope = await readGoldenJson(
		fs,
		fullId,
		`${dir}/tool-pre-write.json`,
	);
	if (!envelope.ok) {
		return err(envelope.error);
	}
	if (!isRecord(envelope.value)) {
		return err(noContract(fullId, "the golden payload must be a JSON object"));
	}
	const payload = field(envelope.value, "payload");
	const eventName = field(envelope.value, "event");
	if (
		payload === undefined ||
		typeof eventName !== "string" ||
		eventName === ""
	) {
		return err(
			noContract(fullId, "the golden payload must carry event and payload"),
		);
	}
	const parsed = adapter.parse(eventName, payload);
	if (!parsed.ok) {
		return err(
			noContract(fullId, "the adapter rejects its own golden payload"),
		);
	}
	let rendered: Array<FileArtifact>;
	try {
		rendered = adapter.render(regenInput(fullId, root));
	} catch {
		return err(noContract(fullId, "render threw on the contract input"));
	}
	const listed = await fs.list(`${dir}/render`);
	if (!listed.ok) {
		return err(noContract(fullId, "the adapter must ship render/ goldens"));
	}
	const goldenNames = [...listed.value].sort();
	if (goldenNames.length === 0) {
		return err(noContract(fullId, "the adapter must ship render/ goldens"));
	}
	const renderedNames = rendered.map((artifact) => artifact.path).sort();
	if (
		renderedNames.length !== goldenNames.length ||
		renderedNames.some((name, index) => name !== goldenNames[index])
	) {
		return err(noContract(fullId, "render differs from the render/ goldens"));
	}
	for (const artifact of rendered) {
		const golden = await fs.readText(`${dir}/render/${artifact.path}`);
		if (!golden.ok || golden.value !== artifact.content) {
			return err(noContract(fullId, "render differs from the render/ goldens"));
		}
	}
	try {
		adapter.reply({ decision: "block", message: "probe", eventId: "probe" });
		adapter.reply({ decision: "allow", eventId: "probe" });
	} catch {
		return err(noContract(fullId, "reply is malformed"));
	}
	return ok(adapter);
}
