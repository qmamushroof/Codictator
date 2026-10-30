// SPEC §4.1.1: symlink-aware confinement for the Fs port. Every path is
// resolved lexically with toRepoPath (EC-2), then the nearest existing prefix
// is resolved with realpath and the remainder re-attached, so a write whose
// real path leaves the repo root and the OS temp dir fails CDX-E701 with
// nothing written (EC-1). On Windows and macOS default volumes the on-disk
// case is canonical when the exact spelling is absent (EC-3).
import { promises as fsp } from "node:fs";
import path from "node:path";
import { ioError, outsideError } from "./fs-errors.ts";
import { toRepoPath } from "./path.ts";
import { pathExists } from "./repo-root.ts";
import { err, ok, type Result } from "./result.ts";

export interface ConfinedPath {
	readonly real: string;
	readonly rel: string;
}

function isWithin(child: string, parent: string): boolean {
	const rel = path.relative(parent, child);
	return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isAllowed(real: string, root: string, tempRoot: string): boolean {
	return (
		real === root ||
		real === tempRoot ||
		isWithin(real, root) ||
		isWithin(real, tempRoot)
	);
}

// SPEC §4.1.2: case-sensitive except on Windows and macOS default volumes,
// where the repo case is canonical. Missing segments stay missing so writes
// to new files keep the caller's spelling.
async function canonicalizeCase(
	logical: string,
	root: string,
): Promise<string> {
	if (process.platform !== "win32" && process.platform !== "darwin") {
		return logical;
	}
	const rel = path.relative(root, logical);
	if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
		return logical;
	}
	const parts = rel.split(path.sep);
	let built = root;
	let index = 0;
	while (index < parts.length) {
		const part = parts[index];
		if (part === undefined || part === "") {
			index += 1;
			continue;
		}
		if (await pathExists(path.join(built, part))) {
			built = path.join(built, part);
			index += 1;
			continue;
		}
		let entries: Array<string>;
		try {
			entries = await fsp.readdir(built);
		} catch {
			break;
		}
		const folded = part.toLowerCase();
		const match = entries.find((entry) => entry.toLowerCase() === folded);
		if (match === undefined) {
			break;
		}
		built = path.join(built, match);
		index += 1;
	}
	if (index >= parts.length) {
		return built;
	}
	return path.join(built, ...parts.slice(index));
}

async function nearestExisting(target: string, root: string): Promise<string> {
	let current = target;
	while (true) {
		if (await pathExists(current)) {
			return current;
		}
		const parent = path.dirname(current);
		if (parent === current) {
			return root;
		}
		current = parent;
	}
}

export async function confinePath(
	input: string,
	root: string,
	tempRoot: string,
): Promise<Result<ConfinedPath>> {
	const rel = toRepoPath(input);
	if (!rel.ok) {
		return err(rel.error);
	}
	const logical = rel.value === "." ? root : path.join(root, rel.value);
	const cased = await canonicalizeCase(logical, root);
	const base = await nearestExisting(cased, root);
	let realBase: string;
	try {
		realBase = await fsp.realpath(base);
	} catch (cause) {
		return err(ioError("resolve", rel.value, cause));
	}
	const rest = path.relative(base, cased);
	const real = rest === "" ? realBase : path.join(realBase, rest);
	if (!isAllowed(real, root, tempRoot)) {
		return err(outsideError());
	}
	return ok({ real, rel: rel.value });
}

// Per-port confinement cache: one verify evaluation pays the case-fold,
// nearest-existing and realpath chain once per path instead of once per
// op, which is what pushed wide evaluations past every guard budget
// (CDX-E902). The cache lives on the owning port (cleared on write,
// append and remove, the only tree changes the port can see), never as
// module state, and shares nothing across evaluations.
export class Confiner {
	private readonly cached = new Map<string, Promise<Result<ConfinedPath>>>();
	private readonly rootDir: string;
	private readonly tempDir: string;

	constructor(rootDir: string, tempDir: string) {
		this.rootDir = rootDir;
		this.tempDir = tempDir;
	}

	confine(input: string): Promise<Result<ConfinedPath>> {
		const hit = this.cached.get(input);
		if (hit !== undefined) {
			return hit;
		}
		const pending = confinePath(input, this.rootDir, this.tempDir);
		this.cached.set(input, pending);
		return pending;
	}

	clear(): void {
		this.cached.clear();
	}
}
