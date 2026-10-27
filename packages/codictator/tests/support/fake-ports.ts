// SPEC §10.2: one-line wiring of every port fake for unit tests. Tests that
// need a single seam import that fake directly; tests that drive a module
// take this bundle so the ports stay consistent with each other.
import type { Instant, Ports } from "../../src/kernel/index.ts";
import { NET_ALLOWLIST } from "../../src/kernel/index.ts";
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
	// SPEC §4.1.3 EC-4: the bundle enforces the §9.2 allowlist, so an
	// off-list request fails CDX-E702; bare FakeNet stays a plain stub.
	const net = new FakeNet({ allowlist: NET_ALLOWLIST });
	const git = new FakeGit();
	const env = new FakeEnv(options.env);
	// SPEC §4.1.3 EC-5: big.bin reads back larger than the EC cap, so the
	// proc fake reports the truncation the real port would.
	proc.when(["cat", "big.bin"], {
		code: 0,
		stdout: "0123456789abcdef".repeat(64),
		stderr: "",
		timedOut: false,
		truncated: false,
	});
	// SPEC §4.1.3 EC-6: sleep ignores the timeout, so the run reports the
	// tree-kill at once, with no wall-clock wait.
	proc.whenHang(["sleep", "30"]);
	// SPEC §4.1.3 EC-11: the bundle has no git repo context, so the
	// presence probe root() answers CDX-E703.
	git.simulateGitMissing();
	const ports: Ports = { fs, proc, net, clock, git, env };
	return { ports, clock, fs, proc, net, git, env };
}
