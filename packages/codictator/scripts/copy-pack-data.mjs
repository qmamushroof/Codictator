// BUG-0002: tsc emits code only, but the built engine reads pack.json and
// the self-test fixtures beside its own directory (loader.ts), so the
// build copies src/builtin-packs into dist/builtin-packs. The npm files
// allowlist already ships dist/, so the published bin keeps working.
// D6: built-in packs take their version from the engine package version
// at build time (single source: packages/codictator/package.json), so the
// stamped dist copies carry the release, never the 0.0.0 placeholder.
import {
	cpSync,
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";

const root = new URL("..", import.meta.url);
rmSync(new URL("dist/builtin-packs/", root), {
	recursive: true,
	force: true,
});
cpSync(
	new URL("src/builtin-packs/", root),
	new URL("dist/builtin-packs/", root),
	{
		recursive: true,
	},
);

const engineManifest = JSON.parse(
	readFileSync(new URL("package.json", root), "utf8"),
);
const manifestVersion =
	typeof engineManifest === "object" &&
	engineManifest !== null &&
	typeof engineManifest.version === "string" &&
	engineManifest.version !== ""
		? engineManifest.version
		: "unknown";
for (const pack of readdirSync(new URL("dist/builtin-packs/", root))) {
	const packJson = new URL(`dist/builtin-packs/${pack}/pack.json`, root);
	// Only core, python and typescript ship a pack.json; other built-in
	// directories carry code, so the stamp skips them.
	if (!existsSync(packJson)) {
		continue;
	}
	const data = JSON.parse(readFileSync(packJson, "utf8"));
	if (
		typeof data === "object" &&
		data !== null &&
		data.version !== manifestVersion
	) {
		data.version = manifestVersion;
		writeFileSync(packJson, `${JSON.stringify(data, null, 2)}\n`);
	}
}
