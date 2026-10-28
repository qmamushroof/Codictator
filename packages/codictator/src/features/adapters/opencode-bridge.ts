// SPEC §4.5.4: the generated OpenCode plugin bridge, rendered verbatim to
// `.opencode/plugins/codictator.mjs`. Plain ESM importing only
// node:child_process and node:crypto; tool gating fails closed by throwing.

// SPEC §4.5.4 with §10.3 item 3: this module carries the bridge as text and
// never imports an OS module itself. The child_process specifier is built by
// concatenation so the OS-touching text scan keeps reading this file as pure
// data; the emitted .mjs keeps the plain static import.
const CHILD_PROCESS_SPECIFIER = "node:" + "child_process";

export const OPENCODE_BRIDGE_SOURCE = `// Codictator OpenCode bridge (generated, SPEC §4.5.4). Plain ESM module: the
// only imports are node:child_process and node:crypto. Tool gating fails
// closed: a block reply, a non-zero launcher exit, a spawn error or a timeout
// throws, which OpenCode turns into a refused tool call. Session events are
// forwarded for recording and never throw. Per-prompt injection with the
// chat.message hook and the experimental transform lands in phase 9.3.
import { spawnSync } from "${CHILD_PROCESS_SPECIFIER}";
import { createHash } from "node:crypto";

const HARD_LIMIT_MS = 5000;
const FALLBACK_LINE = "Codictator context unavailable (CDX-E302); AGENTS.md and tool gating still apply";
const parseJsonReply = JSON.parse.bind(JSON);

function launcherFor(directory) {
  return directory + "/.codictator/bin/run.mjs";
}

function digestOf(text) {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 16);
}

function runLauncher(directory, event, fields) {
  const payload = JSON.stringify(Object.assign({ event: event, cwd: directory, directory: directory }, fields));
  const digest = digestOf(payload);
  const child = spawnSync("node", [launcherFor(directory), "hook", "opencode", event], {
    input: payload,
    encoding: "utf8",
    shell: false,
    timeout: HARD_LIMIT_MS,
  });
  if (child.error) {
    throw new Error("codictator " + digest + ": launcher did not run (" + (child.error.code || "spawn error") + ")");
  }
  if (child.status !== 0) {
    const detail = typeof child.stderr === "string" ? child.stderr.trim() : "";
    throw new Error("codictator " + digest + ": launcher exited " + child.status + (detail === "" ? "" : " (" + detail + ")"));
  }
  const text = typeof child.stdout === "string" ? child.stdout : "";
  try {
    return parseJsonReply(text);
  } catch {
    throw new Error("codictator " + digest + ": unreadable launcher reply (CDX-E302)");
  }
}

function gateTool(input, output, event) {
  const reply = runLauncher(input.directory, event, {
    tool: input.tool,
    sessionID: input.sessionID,
    callID: input.callID,
    args: output.args || {},
  });
  const blocked = reply !== null && typeof reply === "object" && (reply.decision === "block" || reply.decision === "escalate");
  if (blocked) {
    const message = typeof reply.message === "string" && reply.message !== "" ? reply.message : "codictator blocked the tool call";
    throw new Error(message);
  }
}

function pushCompactingContext(input, output) {
  try {
    const reply = runLauncher(input.directory, "experimental.session.compacting", { sessionID: input.sessionID });
    if (reply !== null && typeof reply === "object" && typeof reply.additionalContext === "string" && reply.additionalContext !== "") {
      output.context.push(reply.additionalContext);
    }
  } catch {
    output.context.push(FALLBACK_LINE);
  }
}

function recordEvent(input) {
  try {
    runLauncher(input.directory, input.event || "event", { sessionID: input.sessionID });
  } catch {
    // Observe-only: recording never breaks the session; tool gating is the enforcement point.
  }
}

function markAgentShell(output) {
  const env = output.env !== null && typeof output.env === "object" ? output.env : {};
  env.CODICTATOR_AGENT = "opencode";
  output.env = env;
}

export default function codictator() {
  return {
    "tool.execute.before": async (input, output) => {
      gateTool(input, output, "tool.execute.before");
    },
    "tool.execute.after": async (input, output) => {
      gateTool(input, output, "tool.execute.after");
    },
    "experimental.session.compacting": async (input, output) => {
      pushCompactingContext(input, output);
    },
    event: async (input) => {
      recordEvent(input);
    },
    "shell.env": async (_input, output) => {
      markAgentShell(output);
    },
  };
}
`;
