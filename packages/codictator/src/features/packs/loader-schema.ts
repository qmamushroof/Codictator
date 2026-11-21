// SPEC §4.4.3: the shipped pack schemas read for loading. Metadata keys with
// no validation semantics in the kernel subset (§4.1.2) are stripped here.
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Result } from "../../kernel/index.ts";
import {
	err,
	NodeFs,
	ok,
	parseJson,
	stableStringify,
} from "../../kernel/index.ts";
import { field, isRecord } from "./manifest.ts";

function packageSchemaDir(): string {
	const here = path.dirname(fileURLToPath(import.meta.url));
	return path.resolve(here, "..", "..", "..", "schema");
}

export function toPosix(value: string): string {
	return value.split(path.sep).join("/");
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

export async function readSchemaText(name: string): Promise<Result<string>> {
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
