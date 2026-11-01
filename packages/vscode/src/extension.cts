// SPEC §4.20.1 Module format (§11 S6): the CommonJS extension entry. The
// host requires dist/extension.cjs and calls activate; the shim
// dynamic-imports the ESM dist/main.js (a static require would throw
// ERR_REQUIRE_ESM) and passes it the host vscode API object. Static imports
// stay `import type` from vscode only, so the file is erasable syntax and
// unit tests keep injecting the fake API into src/main.ts. Exports go
// through module.exports: erasableSyntaxOnly forbids both `export` and
// `export =` in this CommonJS module.
import type * as vscode from "vscode";

async function activate(_context: vscode.ExtensionContext): Promise<void> {
	const main = await import("./main.ts");
	await main.activateWithHost(await import("vscode"));
}

module.exports = { activate };
