// SPEC §5.3 F3: the four dependency rules that judge both the fixture
// measure report (`sample.txt` marker files) and the staged real manifest
// (BUG-0107). The live reads are in deps-live.ts; each resolver is one
// combinator call over its marker judge and its live judge.
import type { Ports, Result } from "../../../kernel/index.ts";
import type { Enforcer } from "../../engine/index.ts";
import type { PackRule } from "../index.ts";
import type { EnforcerDecl } from "../manifest.ts";
import { findingFor } from "./binding.ts";
import {
	advisoryVerdict,
	depRule,
	deprecationVerdict,
	judgeLockfiles,
	judgeSnapshot,
} from "./deps-live.ts";
import { judgeNewDeps } from "./deps-new-reason.ts";

// SPEC §5.3 core/dep-lockfile: a missing lockfile blocks.
export function resolveDepLockfile(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return depRule(
		decl,
		rule,
		ports,
		(binding, file, markers) =>
			(markers.get("lockfile") ?? "missing") === "missing"
				? findingFor(binding, {
						path: file,
						message: `no lockfile committed for ${file}`,
						vars: { path: file },
					})
				: undefined,
		judgeLockfiles,
	);
}

// SPEC §5.3 core/dep-new-needs-reason: an unexplained addition blocks.
export function resolveDepNewNeedsReason(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return depRule(
		decl,
		rule,
		ports,
		(binding, file, markers) => {
			const added = markers.get("added") ?? "";
			if (added === "" || (markers.get("reason") ?? "none") !== "none") {
				return undefined;
			}
			return findingFor(binding, {
				path: file,
				message: `${added} in ${file} has no recorded reason`,
				vars: { path: file, value: added },
			});
		},
		judgeNewDeps,
	);
}

// SPEC §5.3 core/dep-no-vulnerable: a pinned advisory blocks.
export function resolveDepNoVulnerable(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return depRule(
		decl,
		rule,
		ports,
		(binding, file, markers) => {
			const advisory = markers.get("advisory") ?? "";
			if (advisory === "" || advisory === "none") {
				return undefined;
			}
			const dep = markers.get("dep") ?? "the dependency";
			return findingFor(binding, {
				path: file,
				message: `${dep} in ${file} has known advisory ${advisory}`,
				vars: { path: file, value: dep, detail: advisory },
			});
		},
		judgeSnapshot(advisoryVerdict),
	);
}

// SPEC §5.3 core/dep-no-deprecated: a deprecated package blocks.
export function resolveDepNoDeprecated(
	decl: EnforcerDecl,
	rule: PackRule,
	ports: Ports,
): Result<Enforcer> {
	return depRule(
		decl,
		rule,
		ports,
		(binding, file, markers) => {
			if ((markers.get("status") ?? "") !== "deprecated") {
				return undefined;
			}
			const dep = markers.get("dep") ?? "the dependency";
			return findingFor(binding, {
				path: file,
				message: `${dep} in ${file} is deprecated`,
				vars: { path: file, value: dep },
			});
		},
		judgeSnapshot(deprecationVerdict),
	);
}
