import { strict as assert } from "node:assert";

import test from "node:test";

import {
	isBuiltinPackId,
	narrowEnforcerDecl,
	narrowManifest,
} from "../../../src/features/packs/manifest.ts";

import { checkParam } from "../../../src/features/packs/params.ts";

test("[§4.4] packs params judge numeric defaults within bound", () => {
	assert.ok(
		checkParam("r", "n", {
			type: "integer",
			default: 3,
			bound: 5,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		checkParam("r", "n", {
			type: "number",
			default: 5,
			bound: 3,
			stricter: "higher",
		}).ok,
	);
	assert.ok(!checkParam("r", "n", "nope").ok);
	assert.ok(
		!checkParam("r", "n", {
			type: "weird",
			default: 1,
			bound: 2,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 2,
			stricter: "sideways",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1.5,
			bound: "x",
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 2,
			min: "x",
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 9,
			min: 2,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 9,
			bound: 9,
			max: 2,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 9,
			bound: 5,
			stricter: "lower",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "n", {
			type: "integer",
			default: 1,
			bound: 5,
			stricter: "higher",
		}).ok,
	);
});

test("[§4.4] packs params judge string lists by subset direction", () => {
	assert.ok(
		checkParam("r", "s", {
			type: "string[]",
			default: ["a"],
			bound: ["a", "b"],
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: "a",
			bound: [],
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: ["a"],
			bound: "b",
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: ["zzz"],
			bound: ["a"],
			stricter: "subset",
		}).ok,
	);
	assert.ok(
		!checkParam("r", "s", {
			type: "string[]",
			default: ["a"],
			bound: ["a", "b"],
			stricter: "superset",
		}).ok,
	);
	assert.ok(
		checkParam("r", "s", {
			type: "string[]",
			default: ["a", "b"],
			bound: ["a"],
			stricter: "superset",
		}).ok,
	);
});

test("[§4.4] packs manifests narrow decls and reject bad shapes", () => {
	assert.equal(isBuiltinPackId("core"), true);
	assert.equal(isBuiltinPackId("custom"), false);
	assert.ok(narrowEnforcerDecl({ id: "e", kind: "code" }).ok);
	assert.ok(
		narrowEnforcerDecl({
			id: "e",
			kind: "external",
			tool: "t",
			ruleMap: { a: "b" },
		}).ok,
	);
	assert.ok(!narrowEnforcerDecl("nope").ok);
	assert.ok(!narrowEnforcerDecl({ kind: "code" }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "mystery" }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "code", module: 1 }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "code", budgetMs: -1 }).ok);
	assert.ok(!narrowEnforcerDecl({ id: "e", kind: "external", tool: "t" }).ok);
	assert.ok(
		!narrowEnforcerDecl({
			id: "e",
			kind: "external",
			tool: "t",
			ruleMap: { a: 1 },
		}).ok,
	);
	assert.ok(!narrowManifest("nope").ok);
	assert.ok(!narrowManifest({ id: "p" }).ok);
	assert.ok(!narrowManifest({ id: "p", rules: [{ id: 1 }] }).ok);
	assert.ok(!narrowManifest({ id: "p", rules: [], enforcers: {} }).ok);
});
