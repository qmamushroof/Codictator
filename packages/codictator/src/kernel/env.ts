// SPEC §4.1.1: the real Env port. A read-only view over process.env for
// harness variables and API-key lookup by name. Reads happen at call time
// and are never cached, and this port never reads `.env`-class files
// (SPEC §9.2); the §9.2 name allowlist governs what child processes inherit
// (buildProcEnv in proc.ts), not what the engine itself may read, because
// this port must resolve API keys and harness variables on demand.
import type { Env } from "./index.ts";

export class NodeEnv implements Env {
	get(name: string): string | undefined {
		return process.env[name];
	}
}
