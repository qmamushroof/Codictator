// SPEC §4.20.2: the live-view regression pin (BUG-0032). registerAllViews
// used to snapshot empty items into an immutable provider whose
// onDidChangeTreeData never fired, so every view stayed empty forever.
import { strict as assert } from "node:assert";
import test from "node:test";
import { createViewProvider } from "../../src/main.ts";

test("[§4.20.2] view providers hold items mutably and fire onDidChangeTreeData", () => {
	// SPEC §4.20.2: the provider behind every Codictator view keeps a live
	// item list; setItems replaces it and fires onDidChangeTreeData once,
	// so the host re-renders. Disposing the subscription stops the fires.
	const provider = createViewProvider(["a"]);
	assert.deepEqual(provider.getChildren(), ["a"]);
	let fires = 0;
	const subscription = provider.onDidChangeTreeData(() => {
		fires += 1;
	});
	provider.setItems(["b", "c"]);
	assert.deepEqual(provider.getChildren(), ["b", "c"]);
	assert.equal(fires, 1);
	subscription.dispose();
	provider.setItems(["d"]);
	assert.deepEqual(provider.getChildren(), ["d"]);
	assert.equal(fires, 1);
});
