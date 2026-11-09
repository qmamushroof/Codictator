// SPEC §4.6.2: the AGENTS.md managed block. Codictator owns the region
// between the markers; text outside it belongs to the user. Content order
// is fixed by the spec: precedence, workflow, floor rules, block action,
// terse output. The block never exceeds 6,000 bytes.
import {
	CONTEXT_BLOCK_MAX_BYTES,
	MANAGED_BEGIN,
	MANAGED_END,
	PRECEDENCE_STATEMENT,
	utf8Bytes,
} from "./precedence.ts";

export interface FloorRuleLine {
	readonly id: string;
	readonly statement: string;
}

export interface ContextFileOptions {
	readonly floorRules?: ReadonlyArray<FloorRuleLine>;
	readonly gateCommands?: ReadonlyArray<string>;
	readonly nonDefaultLimits?: ReadonlyArray<string>;
	readonly workflowPhases?: ReadonlyArray<string>;
}

// A pack manifest narrowed to the fields the floor-rule projection reads,
// so callers pass PackManifest values with no new module edge (SPEC §3.3).
export interface FloorRuleSource {
	readonly rules: ReadonlyArray<{
		readonly id: string;
		readonly tier: string;
		readonly statement: string;
	}>;
}

// SPEC §4.6.2 item 3: every tier:floor rule of the loaded packs, one line
// each, id-sorted for deterministic output (§4.3.6).
export function floorRulesFromManifests(
	manifests: ReadonlyArray<FloorRuleSource>,
): Array<FloorRuleLine> {
	const out: Array<FloorRuleLine> = [];
	for (const manifest of manifests) {
		for (const rule of manifest.rules) {
			if (rule.tier === "floor") {
				out.push({ id: rule.id, statement: rule.statement });
			}
		}
	}
	out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return out;
}

// SPEC §5.1 and §5.9: the steering-owned floor and band rules with their
// pack statements. Callers with an effective rule set pass floorRules;
// the default keeps the block truthful without a config read.
const DEFAULT_FLOOR_RULES: ReadonlyArray<FloorRuleLine> = [
	{
		id: "core/context-soft-band",
		statement: "Keep routine work inside softPercent of the context window.",
	},
	{
		id: "core/context-hard-band",
		statement: "Stop and checkpoint at hardPercent of the context window.",
	},
	{
		id: "core/session-tool-call-limit",
		statement: "Finish within maxToolCalls tool calls per session.",
	},
	{
		id: "core/read-dedupe",
		statement: "Never re-read a file whose content is already in context.",
	},
	{
		id: "core/graph-before-scan",
		statement: "Consult the knowledge-graph output before broad scans.",
	},
	{ id: "core/mcp-declared", statement: "Use only declared MCP servers." },
	{ id: "core/workflow-gates", statement: "Mandatory gates stay in order." },
	{
		id: "core/loop-breaker",
		statement: "Stop after maxRepeats failed attempts.",
	},
];

// SPEC §4.12.2: the seven mandatory phases.
const DEFAULT_WORKFLOW_PHASES: ReadonlyArray<string> = [
	"discovery",
	"planning",
	"implementation",
	"validation",
	"review",
	"record",
	"integrate",
];

// SPEC §4.6.2 item 2 + §4.12.2: the command satisfying each phase's exit
// gate, in phase order. Custom phases reuse the advance command.
const DEFAULT_GATE_COMMANDS: ReadonlyArray<string> = [
	"codictator task new",
	"codictator test red",
	"codictator test green",
	"codictator verify --staged",
	"codictator review submit",
	"codictator task phase next",
];

function floorLines(rules: ReadonlyArray<FloorRuleLine>): Array<string> {
	return rules.map((rule) => `${rule.id} — ${rule.statement}`);
}

function fittedBlockMiddle(
	kept: ReadonlyArray<string>,
	total: number,
): Array<string> {
	const omitted = total - kept.length;
	return omitted > 0
		? [...kept, `and ${omitted} more: codictator context --all`]
		: [...kept];
}

// The block shrinks from the rules list first: precedence, workflow and
// the tail always survive, and the tail pointer names the elided rules.
// The pointer line itself counts against the budget while trimming.
function fitBlock(
	head: ReadonlyArray<string>,
	rules: ReadonlyArray<string>,
	tail: ReadonlyArray<string>,
	maxBytes: number,
): string {
	const keptRules: Array<string> = [...rules];
	let middle = fittedBlockMiddle(keptRules, rules.length);
	while (
		utf8Bytes([...head, ...middle, ...tail].join("\n")) > maxBytes &&
		keptRules.length > 0
	) {
		keptRules.pop();
		middle = fittedBlockMiddle(keptRules, rules.length);
	}
	let block = [...head, ...middle, ...tail].join("\n");
	if (utf8Bytes(block) > maxBytes) {
		const bytes = new TextEncoder().encode(block).slice(0, maxBytes);
		block = new TextDecoder().decode(bytes);
	}
	return block;
}

export function buildManagedBlock(options: ContextFileOptions = {}): string {
	const rules = options.floorRules ?? DEFAULT_FLOOR_RULES;
	const phases = options.workflowPhases ?? DEFAULT_WORKFLOW_PHASES;
	const gates = options.gateCommands ?? DEFAULT_GATE_COMMANDS;
	const limits = options.nonDefaultLimits ?? [];
	const head: Array<string> = [
		MANAGED_BEGIN,
		PRECEDENCE_STATEMENT,
		"",
		`Workflow: ${phases.join(" > ")}. Advance with codictator task phase next.`,
		`Gates: ${gates.join(" > ")}.`,
		"",
		"Floor rules:",
	];
	const tail: Array<string> = [
		limits.length === 0
			? "Limits: defaults (softPercent 60, hardPercent 75, maxToolCalls 300, maxRepeats 3)."
			: `Limits: ${limits.join("; ")}.`,
		"On block: apply Do instead, never retry a variation, escalate at the loop-breaker count.",
		"Output: terse. codictator explain <id> names the rule; codictator context shows this file.",
		MANAGED_END,
	];
	return fitBlock(head, floorLines(rules), tail, CONTEXT_BLOCK_MAX_BYTES);
}

// SPEC §4.6.2: the managed block for a session. The block is repo-level,
// so every session renders the same text; maxBytes below the 6,000-byte
// cap tightens the budget further.
export function renderContextFile(
	_sessionId: string,
	maxBytes: number,
): Promise<string> {
	const block = buildManagedBlock();
	const limit = Math.min(maxBytes, CONTEXT_BLOCK_MAX_BYTES);
	if (utf8Bytes(block) <= limit) {
		return Promise.resolve(block);
	}
	const lines = block.split("\n");
	return Promise.resolve(
		fitBlock(lines.slice(0, 2), lines.slice(2, -1), lines.slice(-1), limit),
	);
}
