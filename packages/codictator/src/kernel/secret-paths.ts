// SPEC §4.7.1 secret-read guard: the paths that must never reach the
// agent context (tool.pre.read and shell commands that print files). The
// .env family exempts .env.example; dotfiles with auth lines (.npmrc,
// .pypirc, nuget.config) block as whole files; home-relative secret dirs
// match lexically. Also owns the default fixture-glob exemption: values
// under fixture dirs are test vectors, never live credentials.
import { globMatch } from "./glob.ts";

const SECRET_BASENAMES = new Set([".npmrc", ".pypirc", "nuget.config"]);

const SECRET_DIR_SEGMENTS = new Set([".ssh", ".aws", ".gnupg"]);

export const DEFAULT_FIXTURE_GLOBS: ReadonlyArray<string> = [
	"**/fixtures/**",
	"**/fixture/**",
	"**/__fixtures__/**",
	"**/testdata/**",
	"**/test-data/**",
	"**/*.fixture.*",
];

// The home-prefix patterns live at module scope so their quantifiers
// never count as branches of the function that applies them.
const HOME_PREFIX_PATTERNS: ReadonlyArray<RegExp> = [
	/^~[/\\]?/,
	/^\$home[/\\]?/,
	/^\$\{home\}[/\\]?/,
	/^%userprofile%[/\\]?/,
];

function isEnvSecretFile(base: string): boolean {
	return (
		base === ".env" || (base.startsWith(".env.") && base !== ".env.example")
	);
}

function isKeyMaterialFile(base: string): boolean {
	return (
		base.endsWith(".pem") ||
		base.endsWith(".key") ||
		base.endsWith(".p12") ||
		base.endsWith(".pfx") ||
		base.startsWith("id_rsa") ||
		base.startsWith("id_ed25519")
	);
}

function homeRelativePath(slashed: string): string {
	let relative = slashed.toLowerCase();
	for (const pattern of HOME_PREFIX_PATTERNS) {
		relative = relative.replace(pattern, "");
	}
	return relative;
}

function isSecretDirPath(slashed: string): boolean {
	const segments = homeRelativePath(slashed).split("/");
	return (
		segments.some((segment) => SECRET_DIR_SEGMENTS.has(segment)) ||
		(segments[0] === ".config" && segments[1] === "gh")
	);
}

// SPEC §4.7.1: the secret-read guard paths.
export function isSecretReadPath(path: string): boolean {
	const slashed = path.replace(/\\/g, "/");
	const base = slashed.split("/").pop() ?? "";
	if (isEnvSecretFile(base)) {
		return true;
	}
	if (isKeyMaterialFile(base)) {
		return true;
	}
	if (SECRET_BASENAMES.has(base)) {
		return true;
	}
	return isSecretDirPath(slashed);
}

// SPEC §4.7.1: placeholder credentials and test vectors under a declared
// fixture glob are allowlisted. The kernel default covers the common
// fixture layouts; the check takes configured globs when the caller has
// them (phase 4 config), so the default never silently widens.
export function isFixturePath(
	path: string,
	globs: ReadonlyArray<string> = DEFAULT_FIXTURE_GLOBS,
): boolean {
	return globs.some((glob) => globMatch(glob, path));
}
