// SPEC §10.2: one-line wiring of every port fake for unit tests. Tests that
// need a single seam import that fake directly; tests that drive a module
// take this bundle so the ports stay consistent with each other.
import type { Instant, Ports } from "../../src/kernel/index.ts";
import { FakeClock, FIXED_INSTANT } from "./fake-clock.ts";
import { FakeEnv } from "./fake-env.ts";
import { FakeFs } from "./fake-fs.ts";
import { FakeGit } from "./fake-git.ts";
import { FakeNet } from "./fake-net.ts";
import { FakeProc } from "./fake-proc.ts";

export interface FakePortsOptions {
	readonly instant?: Instant;
	readonly env?: Readonly<Record<string, string>>;
}

export interface FakePorts {
	readonly ports: Ports;
	readonly clock: FakeClock;
	readonly fs: FakeFs;
	readonly proc: FakeProc;
	readonly net: FakeNet;
	readonly git: FakeGit;
	readonly env: FakeEnv;
}

export function createFakePorts(options: FakePortsOptions = {}): FakePorts {
	const clock = new FakeClock(options.instant ?? FIXED_INSTANT);
	const fs = new FakeFs();
	const proc = new FakeProc();
	const net = new FakeNet();
	const git = new FakeGit();
	const env = new FakeEnv(options.env);
	const ports: Ports = { fs, proc, net, clock, git, env };
	return { ports, clock, fs, proc, net, git, env };
}
