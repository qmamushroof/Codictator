// SPEC §4.11.1: the four profiles and the module kinds each one allows.
export const ARCH_PROFILES = ["app", "library", "cli", "service"] as const;

export type ArchProfile = (typeof ARCH_PROFILES)[number];

export function isArchProfile(value: string): value is ArchProfile {
	return (ARCH_PROFILES as ReadonlyArray<string>).includes(value);
}
