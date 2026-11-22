// SPEC §4.19.8 steps 1, 3 and 4: where the engine pin lives, how exact
// versions compare, and how the files an upgrade rewrites are edited and
// restored. Text edits only: manifests and the config keep their bytes
// except for the one version string.
import type { Result } from "../kernel/index.ts";
import { err, ok } from "../kernel/index.ts";
import { portsFor, readStateText, writeStateText } from "./shared.ts";

export interface UpgradePin {
	readonly manifestRel: string;
	readonly dirRel: string;
	readonly lockRel: string;
	readonly version: string;
}

const ROOT_PIN =
	/("devDependencies"\s*:\s*\{[^}]*?"codictator"\s*:\s*")([^"]*)(")/s;
const TOOL_PIN = /("codictator"\s*:\s*")([^"]*)(")/;
const CONFIG_PIN = /("codictator"\s*:\s*")([^"]*)(")/;

// SPEC §4.19.4: npm repos pin the engine as a root devDependency, other
// repos in the tool manifest; the root wins when it carries the pin.
export async function locateUpgradePin(
	root: string,
): Promise<UpgradePin | undefined> {
	const rootText = await readStateText(root, "package.json");
	const rootVersion =
		rootText === undefined ? undefined : ROOT_PIN.exec(rootText)?.[2];
	if (rootVersion !== undefined) {
		return {
			manifestRel: "package.json",
			dirRel: ".",
			lockRel: "package-lock.json",
			version: rootVersion,
		};
	}
	const toolRel = ".codictator/tool/package.json";
	const toolText = await readStateText(root, toolRel);
	const toolVersion =
		toolText === undefined ? undefined : TOOL_PIN.exec(toolText)?.[2];
	if (toolVersion === undefined) {
		return undefined;
	}
	return {
		manifestRel: toolRel,
		dirRel: ".codictator/tool",
		lockRel: ".codictator/tool/package-lock.json",
		version: toolVersion,
	};
}

export function parseExactVersion(
	text: string,
): readonly [number, number, number] | undefined {
	const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text);
	if (match === null) {
		return undefined;
	}
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

// Negative when a < b, zero when equal, positive when a > b.
export function compareExact(
	a: readonly [number, number, number],
	b: readonly [number, number, number],
): number {
	return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

export function pinEdit(pin: UpgradePin, text: string, to: string): string {
	const pattern = pin.dirRel === "." ? ROOT_PIN : TOOL_PIN;
	return text.replace(
		pattern,
		(_all, head: string, _old: string, tail: string) => `${head}${to}${tail}`,
	);
}

export function configEdit(text: string, to: string): string {
	return text.replace(
		CONFIG_PIN,
		(_all, head: string, _old: string, tail: string) => `${head}${to}${tail}`,
	);
}

// SPEC §4.19.8 step 4: the bytes of every file the write step touches,
// kept so a failed install leaves the repo as it was.
export type UpgradeSnapshot = ReadonlyMap<string, string | undefined>;

export async function snapshotFiles(
	root: string,
	rels: ReadonlyArray<string>,
): Promise<UpgradeSnapshot> {
	const kept = new Map<string, string | undefined>();
	for (const rel of rels) {
		kept.set(rel, await readStateText(root, rel));
	}
	return kept;
}

export async function restoreFiles(
	root: string,
	snapshot: UpgradeSnapshot,
): Promise<Result<void>> {
	const ports = await portsFor(root);
	if (!ports.ok) {
		return err(ports.error);
	}
	for (const [rel, text] of snapshot) {
		const present = await ports.value.fs.exists(rel);
		if (text === undefined && !(present.ok && present.value)) {
			continue;
		}
		const done =
			text === undefined
				? await ports.value.fs.remove(rel)
				: await writeStateText(root, rel, text);
		if (!done.ok) {
			return err(done.error);
		}
	}
	return ok(undefined);
}
