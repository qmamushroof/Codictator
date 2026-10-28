// SPEC §4.4.6 command-forbid: denied commands matched through the §4.7.2
// shell analyser. Shell text arrives as `run:` lines of the scanned files
// (shared with dangerous-shell); a whole shell script counts as one
// source. An unparseable source fails closed with CDX-E306.
import {
	analyseShell,
	err,
	ok,
	type Ports,
	type Result,
} from "../../../kernel/index.ts";
import type { CheckContext, Finding } from "../../engine/index.ts";
import { field } from "../manifest.ts";
import {
	argsRecord,
	bindingError,
	findingFor,
	type RuleBinding,
	readErrorFinding,
	readLossyText,
	selectFiles,
	stringList,
} from "./binding.ts";
import { extractShellSources } from "./shell-analyse.ts";

export interface CommandForbidConfig {
	readonly commands: ReadonlyArray<string>;
}

// SPEC §4.4.6: the deny list arrives in decl args as non-empty command
// names; matching is case-insensitive, like the analyser's own names.
export function narrowCommandForbidArgs(
	declId: string,
	args: unknown,
): Result<CommandForbidConfig> {
	const record = argsRecord(declId, args);
	if (!record.ok) {
		return err(record.error);
	}
	const commands = (stringList(field(record.value, "commands")) ?? []).filter(
		(entry) => entry.length > 0,
	);
	if (commands.length === 0) {
		return bindingError(declId, "needs a non-empty commands list in args");
	}
	return ok({ commands });
}

export async function checkCommandForbid(
	ports: Ports,
	binding: RuleBinding,
	config: CommandForbidConfig,
	ctx: CheckContext,
): Promise<Array<Finding>> {
	const denied = new Set(config.commands.map((entry) => entry.toLowerCase()));
	const findings: Array<Finding> = [];
	for (const file of selectFiles(ctx.scope.files, binding.scopeGlobs)) {
		const loaded = await readLossyText(ports.fs, file);
		if (!loaded.ok) {
			findings.push(readErrorFinding(binding, file, loaded.error, "read"));
			continue;
		}
		for (const source of extractShellSources(loaded.value.text, file)) {
			const parsed = analyseShell(source);
			if (!parsed.ok) {
				findings.push(
					findingFor(binding, {
						path: file,
						code: parsed.error.code,
						message: `shell command in ${file} is unparseable`,
						vars: { path: file },
					}),
				);
				continue;
			}
			for (const pipeline of parsed.value.pipelines) {
				for (const command of pipeline.commands) {
					const name = command.name
						.replace(/\\/g, "/")
						.split("/")
						.pop()
						?.toLowerCase();
					if (name !== undefined && denied.has(name)) {
						findings.push(
							findingFor(binding, {
								path: file,
								message: `forbidden command ${command.name} in ${file}`,
								vars: { path: file },
							}),
						);
					}
				}
			}
		}
	}
	return findings;
}
