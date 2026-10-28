// SPEC §5.3 and §6.1: the npm capability catalogue and the license allow
// policy. One repo holds one package per capability; platform entries name
// the pinned-platform cover (Node >= 24).
export const DEFAULT_LICENSE_ALLOW: ReadonlyArray<string> = [
	"MIT",
	"ISC",
	"BSD-2-Clause",
	"BSD-3-Clause",
	"Apache-2.0",
	"0BSD",
	"BlueOak-1.0.0",
	"Unlicense",
	"CC0-1.0",
	"Python-2.0",
	"MPL-2.0",
];

// SPEC §6.1: package names grouped by the capability they provide.
const NPM_CAPABILITIES: Readonly<Record<string, string>> = {
	axios: "http-client",
	got: "http-client",
	"node-fetch": "http-client",
	ky: "http-client",
	superagent: "http-client",
	undici: "http-client",
	request: "http-client",
	"cross-fetch": "http-client",
	uuid: "unique-ids",
	nanoid: "unique-ids",
	dotenv: "env-files",
	jest: "test-runner",
	vitest: "test-runner",
	mocha: "test-runner",
	ava: "test-runner",
	jasmine: "test-runner",
	tap: "test-runner",
	glob: "glob",
	"fast-glob": "glob",
	globby: "glob",
	rimraf: "recursive-fs",
	mkdirp: "recursive-fs",
	"fs-extra": "recursive-fs",
	"lodash.clonedeep": "deep-clone",
	"clone-deep": "deep-clone",
	rfdc: "deep-clone",
	chalk: "terminal-colours",
	kleur: "terminal-colours",
	picocolors: "terminal-colours",
	colors: "terminal-colours",
	commander: "argument-parsing",
	yargs: "argument-parsing",
	minimist: "argument-parsing",
	meow: "argument-parsing",
	moment: "dates",
	dayjs: "dates",
	"date-fns": "dates",
	luxon: "dates",
	zod: "schema-validation",
	yup: "schema-validation",
	joi: "schema-validation",
	ajv: "schema-validation",
	valibot: "schema-validation",
	superstruct: "schema-validation",
	prettier: "format",
	"@biomejs/biome": "format",
	dprint: "format",
	eslint: "lint",
	oxlint: "lint",
	lodash: "utility-belt",
	underscore: "utility-belt",
	ramda: "utility-belt",
	remeda: "utility-belt",
};

const PLATFORM_CAPABILITIES: Readonly<Record<string, string>> = {
	"http-client": "fetch",
	"unique-ids": "crypto.randomUUID",
	"env-files": "node --env-file",
	"test-runner": "node:test",
	glob: "fs.glob",
	"recursive-fs": "fs.rm with recursive",
	"deep-clone": "structuredClone",
	"terminal-colours": "util.styleText",
	"argument-parsing": "util.parseArgs",
};

// SPEC §6.4 EC-1: Biome and Prettier together block on the shared "format"
// capability; both entries carry it.
export function capabilityOf(packageName: string): string | undefined {
	return NPM_CAPABILITIES[packageName];
}

export function platformCapabilityCover(
	capability: string,
): string | undefined {
	return PLATFORM_CAPABILITIES[capability];
}
