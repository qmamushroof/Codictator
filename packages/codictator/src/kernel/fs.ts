// SPEC §4.1.1: the real Fs port. All paths resolve against the repo root
// (explicit, CODICTATOR_ROOT, or .git find-up from cwd); a write whose real
// path after symlink resolution leaves the repo root or the OS temp dir fails
// CDX-E701 with nothing written. Writes are atomic (temp file + rename) and
// never executable (§9.2). Text is UTF-8 with the BOM stripped; non-UTF-8
// stays bytes and readText reports binary-or-unknown-encoding (EC-12).
import { randomBytes } from "node:crypto";
import { promises as fsp } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeError } from "./errors.ts";
import { confinePath } from "./fs-confine.ts";
import {
	encodingError,
	ioError,
	outsideError,
	readFailure,
} from "./fs-errors.ts";
import { globMatch } from "./glob.ts";
import type { Fs, FsStat } from "./index.ts";
import { pathExists, resolveRepoRoot } from "./repo-root.ts";
import { err, ok, type Result } from "./result.ts";

export interface NodeFsOptions {
	readonly root?: string;
	readonly startDir?: string;
	readonly tempDir?: string;
}

const WRITE_SUFFIX_BYTES = 8;

function isRootPath(real: string, root: string, tempRoot: string): boolean {
	return real === root || real === tempRoot;
}

export class NodeFs implements Fs {
	private readonly root: string;
	private readonly tempRoot: string;

	private constructor(root: string, tempRoot: string) {
		this.root = root;
		this.tempRoot = tempRoot;
	}

	static async create(options: NodeFsOptions = {}): Promise<Result<NodeFs>> {
		const { CODICTATOR_ROOT } = process.env;
		const explicit = options.root ?? CODICTATOR_ROOT;
		try {
			const tempRoot = await fsp.realpath(options.tempDir ?? tmpdir());
			if (explicit !== undefined) {
				const real = await fsp.realpath(explicit);
				const st = await fsp.stat(real);
				if (!st.isDirectory()) {
					return err(
						makeError(
							"CDX-E903",
							`repo root ${explicit} is not a directory`,
							"Point the root at a directory holding the repo.",
						),
					);
				}
				return ok(new NodeFs(real, tempRoot));
			}
		} catch (cause) {
			return err(ioError("resolve root", explicit ?? tmpdir(), cause));
		}
		const resolved = await resolveRepoRoot(options.startDir ?? process.cwd());
		if (!resolved.ok) {
			return err(resolved.error);
		}
		try {
			const tempRoot = await fsp.realpath(options.tempDir ?? tmpdir());
			return ok(new NodeFs(resolved.value, tempRoot));
		} catch (cause) {
			return err(ioError("resolve temp", tmpdir(), cause));
		}
	}

	private loadFile(real: string, rel: string): Promise<Result<Uint8Array>> {
		return fsp.readFile(real).then(
			(data) =>
				ok(new Uint8Array(data.buffer, data.byteOffset, data.byteLength)),
			(cause: unknown) => readFailure(rel, cause),
		);
	}

	async read(input: string): Promise<Result<Uint8Array>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		return this.loadFile(confined.value.real, confined.value.rel);
	}

	async readText(input: string): Promise<Result<string>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		const loaded = await this.loadFile(confined.value.real, confined.value.rel);
		if (!loaded.ok) {
			return err(loaded.error);
		}
		const bytes = loaded.value;
		const body =
			bytes.length >= 3 &&
			bytes[0] === 0xef &&
			bytes[1] === 0xbb &&
			bytes[2] === 0xbf
				? bytes.subarray(3)
				: bytes;
		try {
			return ok(new TextDecoder("utf-8", { fatal: true }).decode(body));
		} catch {
			return err(encodingError(confined.value.rel));
		}
	}

	private async writeAtomic(
		real: string,
		rel: string,
		content: Uint8Array,
	): Promise<Result<void>> {
		const dir = path.dirname(real);
		const tmp = path.join(
			dir,
			`.codictator-${randomBytes(WRITE_SUFFIX_BYTES).toString("hex")}.tmp`,
		);
		try {
			await fsp.mkdir(dir, { recursive: true });
			await fsp.writeFile(tmp, content, { mode: 0o666 });
			await fsp.rename(tmp, real);
			return ok(undefined);
		} catch (cause) {
			await fsp.rm(tmp, { force: true }).catch(() => undefined);
			return err(ioError("write", rel, cause));
		}
	}

	async write(input: string, content: Uint8Array): Promise<Result<void>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		if (isRootPath(confined.value.real, this.root, this.tempRoot)) {
			return err(outsideError());
		}
		return this.writeAtomic(confined.value.real, confined.value.rel, content);
	}

	async append(input: string, content: Uint8Array): Promise<Result<void>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		if (isRootPath(confined.value.real, this.root, this.tempRoot)) {
			return err(outsideError());
		}
		let prior: Uint8Array = new Uint8Array(0);
		if (await pathExists(confined.value.real)) {
			const loaded = await this.loadFile(
				confined.value.real,
				confined.value.rel,
			);
			if (!loaded.ok) {
				return err(loaded.error);
			}
			prior = loaded.value;
		}
		const joined = new Uint8Array(prior.length + content.length);
		joined.set(prior, 0);
		joined.set(content, prior.length);
		return this.writeAtomic(confined.value.real, confined.value.rel, joined);
	}

	async stat(input: string): Promise<Result<FsStat>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		try {
			const st = await fsp.stat(confined.value.real);
			return ok({
				isFile: st.isFile(),
				isDirectory: st.isDirectory(),
				size: st.size,
			});
		} catch (cause) {
			return readFailure(confined.value.rel, cause);
		}
	}

	async list(dir: string): Promise<Result<Array<string>>> {
		const confined = await confinePath(dir, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		try {
			const names = await fsp.readdir(confined.value.real);
			names.sort();
			return ok(names);
		} catch (cause) {
			return readFailure(confined.value.rel, cause);
		}
	}

	private async collectGlob(
		root: string,
		current: string,
		pattern: string,
		found: Array<string>,
	): Promise<void> {
		const entries = await fsp.readdir(current, { withFileTypes: true });
		const names = entries.map((entry) => entry.name);
		names.sort();
		for (const name of names) {
			const full = path.join(current, name);
			found.push(path.relative(root, full).split(path.sep).join("/"));
			// SPEC §4.1.1: lstat, never stat, so a symlinked directory is
			// listed but never descended into (cycle guard).
			if ((await fsp.lstat(full)).isDirectory()) {
				await this.collectGlob(root, full, pattern, found);
			}
		}
	}

	async glob(pattern: string, dir: string): Promise<Result<Array<string>>> {
		const confined = await confinePath(dir, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		const found: Array<string> = [];
		try {
			await this.collectGlob(
				confined.value.real,
				confined.value.real,
				pattern,
				found,
			);
		} catch (cause) {
			return err(ioError("glob", confined.value.rel, cause));
		}
		const matched = found.filter((rel) => globMatch(pattern, rel));
		matched.sort();
		const prefix = confined.value.rel === "." ? "" : `${confined.value.rel}/`;
		return ok(matched.map((rel) => `${prefix}${rel}`));
	}

	async exists(input: string): Promise<Result<boolean>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		return ok(await pathExists(confined.value.real));
	}

	async realpath(input: string): Promise<Result<string>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		try {
			const real = await fsp.realpath(confined.value.real);
			const rel = path.relative(this.root, real).split(path.sep).join("/");
			if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return ok(rel);
			}
			return ok(real);
		} catch (cause) {
			return readFailure(confined.value.rel, cause);
		}
	}

	async remove(input: string): Promise<Result<void>> {
		const confined = await confinePath(input, this.root, this.tempRoot);
		if (!confined.ok) {
			return err(confined.error);
		}
		if (isRootPath(confined.value.real, this.root, this.tempRoot)) {
			return err(outsideError());
		}
		try {
			await fsp.rm(confined.value.real, { recursive: true, force: true });
			return ok(undefined);
		} catch (cause) {
			return err(ioError("remove", confined.value.rel, cause));
		}
	}
}
