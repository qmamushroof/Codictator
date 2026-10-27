// SPEC §4.4.2: the core built-in pack. Rule data binding enforcers; the
// pack loader validates every rule against §7.3 before use.
import type { Pack } from "../../features/packs/index.ts";

// SPEC §4.4.2: core pack manifest (rules of family core, §5).
export function corePack(): Pack {
	throw new Error("not implemented: SPEC §4.4.2");
}
