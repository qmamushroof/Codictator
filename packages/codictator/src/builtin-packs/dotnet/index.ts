// SPEC §4.4.2 and §6: the dotnet built-in pack (language rules plus
// ecosystem driver and extractors).
import type { Pack } from "../../kernel/index.ts";

// SPEC §6: dotnet pack manifest with its driver and extractors.
export function dotnetPack(): Pack {
	throw new Error("not implemented: SPEC §6");
}
