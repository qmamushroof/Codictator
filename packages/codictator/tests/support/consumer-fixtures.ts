// Source fixtures for the L3/L4 range probe, kept apart so the firing suite
// stays under the core/file-size cap.

// A function whose throw-guard the head commit deletes (core/no-guard-removal).
const MX_GUARD_BASE =
	'export function mxGuard(n: number): number {\n  if (n < 0) {\n    throw new Error("negative");\n  }\n  return n;\n}\n';

const MX_GUARD_HEAD =
	"export function mxGuard(n: number): number {\n  return n;\n}\n";

// An interface with exactly one implementation (core/no-speculative-abstraction).
const MX_ABSTRACTION =
	"export interface MxShape {\n  run(): void;\n}\n\nexport class MxOnly implements MxShape {\n  run(): void {}\n}\n";

export const MX = {
	guardBase: MX_GUARD_BASE,
	guardHead: MX_GUARD_HEAD,
	abstraction: MX_ABSTRACTION,
} as const;
