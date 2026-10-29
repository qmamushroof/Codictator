// BUG-0002: tsc emits code only, but the built engine reads pack.json and
// the self-test fixtures beside its own directory (loader.ts), so the
// build copies src/builtin-packs into dist/builtin-packs. The npm files
// allowlist already ships dist/, so the published bin keeps working.
import { cpSync, rmSync } from "node:fs";

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
