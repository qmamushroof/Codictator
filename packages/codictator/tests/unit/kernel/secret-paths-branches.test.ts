// Standing deviation (same as the branch deviation): these branch-level unit
// tests pass green and stay unlisted while the future-phase red rows stay
// listed. Covers SPEC §4.7.1 secret-read guard paths: key basenames,
// dotfile allowlist entries, home-relative secret dirs and the .env.example
// exemption. Pure string matching; no I/O.
import { strict as assert } from "node:assert";
import test from "node:test";
import { isSecretReadPath } from "../../../src/kernel/index.ts";

test("[§4.7.1] secret reads flag key basenames and dotfiles", () => {
	assert.equal(isSecretReadPath("id_rsa"), true);
	assert.equal(isSecretReadPath("id_ed25519.pub"), true);
	assert.equal(isSecretReadPath("server.pem"), true);
	assert.equal(isSecretReadPath(".npmrc"), true);
	assert.equal(isSecretReadPath("sub/nuget.config"), true);
	assert.equal(isSecretReadPath(".env.example"), false);
	assert.equal(isSecretReadPath("notes.txt"), false);
});

test("[§4.7.1] secret reads flag home-relative secret directories", () => {
	assert.equal(isSecretReadPath("~/.ssh/config"), true);
	assert.equal(isSecretReadPath("$HOME/.aws/credentials"), true);
	assert.equal(isSecretReadPath("~/.config/gh/hosts.yml"), true);
	assert.equal(isSecretReadPath("~/.config/other/app.conf"), false);
});
