// SPEC §10.2: an in-memory Env port for unit tests (SPEC §4.1.1). The map is
// seeded per test, so harness variables and key lookups stay deterministic.
import type { Env } from "../../src/kernel/index.ts";

export class FakeEnv implements Env {
	private readonly values: Map<string, string>;

	constructor(initial: Readonly<Record<string, string>> = {}) {
		this.values = new Map(Object.entries(initial));
	}

	get(name: string): string | undefined {
		return this.values.get(name);
	}

	set(name: string, value: string): void {
		this.values.set(name, value);
	}

	remove(name: string): void {
		this.values.delete(name);
	}
}
