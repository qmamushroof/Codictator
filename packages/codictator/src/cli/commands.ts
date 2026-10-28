// SPEC §4.19.2: the command table. The composition root (index.ts) scans
// the global flags, then dispatches through this table; every §4.19.2
// command is routed, and anything else is a usage error.
import type { Result } from "../kernel/index.ts";
import { handleBaseline } from "./baseline.ts";
import { handleCi } from "./ci.ts";
import { handleDeps } from "./deps.ts";
import {
	handleInstallHooks,
	handleRegen,
	handleUninstall,
} from "./guardrail.ts";
import { handleInit } from "./init.ts";
import { handleStatus, handleVerify } from "./inspect.ts";
import {
	handleAdapter,
	handleGenerate,
	handlePack,
	handleServe,
} from "./packs.ts";
import { handleReview } from "./proofs.ts";
import { handleTestCmd } from "./proofs-test.ts";
import { handleRemediate } from "./remediation.ts";
import { handleContext, handleReport } from "./report.ts";
import type { CommandRequest } from "./shared.ts";
import { handleTask } from "./task-advance.ts";
import { handleExplain, handleReplay } from "./transparency.ts";
import { handleWaive } from "./waivers.ts";

export type Handler = (req: CommandRequest) => Promise<Result<number>>;

export const COMMANDS: Readonly<Record<string, Handler>> = {
	init: handleInit,
	"install-hooks": handleInstallHooks,
	regen: handleRegen,
	uninstall: handleUninstall,
	verify: handleVerify,
	status: handleStatus,
	explain: handleExplain,
	replay: handleReplay,
	report: handleReport,
	context: handleContext,
	task: handleTask,
	test: handleTestCmd,
	review: handleReview,
	waive: handleWaive,
	baseline: handleBaseline,
	deps: handleDeps,
	remediate: handleRemediate,
	ci: handleCi,
	generate: handleGenerate,
	pack: handlePack,
	adapter: handleAdapter,
	serve: handleServe,
};

export const USAGE =
	"usage: codictator <init|install-hooks|regen|uninstall|verify|status|explain|replay|report|context|hook|task|test|review|waive|baseline|deps|remediate|ci|generate|pack|adapter|serve> [--json] [--cwd <path>] [--quiet]";
