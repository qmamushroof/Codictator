// SPEC §6.1 measures: characterisation of exported-name extraction edge cases.
import { strict as assert } from "node:assert";
import test from "node:test";
import { findExportedNames } from "../../../src/builtin-packs/typescript/index.ts";
import * as exportsModule from "../../../src/builtin-packs/typescript/measures-exports.ts";

test("[§6.1] ts exported names pin declaration and list forms", () => {
	assert.deepEqual(
		findExportedNames(
			"export declare function a(): void;\nexport async function b() {}\nexport function* c() {}\nexport abstract class D {}\nexport type T = 1;\nexport type { U, V as W };\nexport enum E {}\nexport let l = 1;\nexport var v = 2;",
		),
		["D", "E", "U", "W", "a", "b", "c", "l", "v"],
	);
	assert.deepEqual(
		findExportedNames(
			"export { a as b, type c, d } ;\nexport {x} from './y';\nexport {z}\nfrom './w';",
		),
		["b", "d", "type"],
	);
	assert.deepEqual(findExportedNames("export { a, b"), []);
});

test("[§6.1] ts exported names pin bindings, defaults and trivia", () => {
	assert.deepEqual(
		findExportedNames(
			"export const [p, q] = arr;\nexport let { r = 1, s: t } = o;",
		),
		["p", "q", "r"],
	);
	assert.deepEqual(
		findExportedNames(
			"export default function f() {}\nexport * as ns from './n';\nexport * from './m';",
		),
		["default"],
	);
	assert.deepEqual(
		findExportedNames(
			"// export const hidden = 1;\nconst s = 'export const str = 1';\nexport const real = 1;",
		),
		["real"],
	);
	assert.deepEqual(findExportedNames("exportx const no = 1; export"), []);
	assert.deepEqual(
		findExportedNames("export type default;\nexport declare const { m } = o;"),
		["default", "m"],
	);
});

test("[§6.1] ts export list reader returns names and the resume index", () => {
	const names: Array<string> = [];
	const text = "export { a as b, c } ;";
	const next = exportsModule.readExportList(text, 7, names);
	assert.deepEqual(names, ["b", "c"]);
	assert.equal(next, 20);
	const reexport: Array<string> = [];
	assert.equal(
		exportsModule.readExportList("export { a } from './x';", 7, reexport),
		12,
	);
	assert.deepEqual(reexport, []);
	assert.equal(exportsModule.readExportList("export { a", 7, reexport), -1);
});
