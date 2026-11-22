// SPEC §4.7.1: characterisation of the assignment detector and its name-run helper.
import { strict as assert } from "node:assert";
import test from "node:test";
import * as redact from "../../../src/kernel/redact.ts";

test("[§4.7.1] assignment name start walks back over the name run and one quote", () => {
	assert.equal(redact.assignmentNameStart("my_secret", 3), 0);
	assert.equal(redact.assignmentNameStart('x "aws.secret', 9), 2);
	assert.equal(redact.assignmentNameStart("a b_token", 4), 2);
	assert.equal(redact.assignmentNameStart("token", 0), 0);
});

test("[§4.7.1] assignments: entropy, length, placeholders and separators", () => {
	const hi = "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7";
	const quoted = `api_key = "${hi}"`;
	assert.equal(redact.redactSecrets(quoted), `api_…(${quoted.length})`);
	assert.equal(
		redact.redactSecrets(`password=${hi}`),
		`pass…(${`password=${hi}`.length})`,
	);
	assert.equal(
		redact.redactSecrets(`aws_secret_access_key: '${hi}'`),
		`aws_…(${`aws_secret_access_key: '${hi}'`.length})`,
	);
	assert.equal(
		redact.redactSecrets(`"token": "${hi}" tail`),
		`"tok…(${`"token": "${hi}"`.length}) tail`,
	);
	assert.equal(redact.redactSecrets("secret=short"), "secret=short");
	assert.equal(
		redact.redactSecrets("secret=aaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
		"secret=aaaaaaaaaaaaaaaaaaaaaaaaaaaa",
	);
	assert.equal(
		redact.redactSecrets("secret=your-secret-goes-here-please"),
		"secret=your-secret-goes-here-please",
	);
	assert.equal(redact.redactSecrets(`secret ${hi}`), `secret ${hi}`);
	assert.equal(
		redact.redactSecrets(`secret=process.env.${hi}`),
		`secret=process.env.${hi}`,
	);
	assert.equal(redact.redactSecrets("secret="), "secret=");
});
