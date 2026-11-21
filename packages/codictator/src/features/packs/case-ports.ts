// SPEC §4.4.1 + §4.4.4: the ports a case runs against. `files` is the only
// source of a case's files, so the Fs is an in-memory map and every other
// port is inert: no process, no network, no git history, no environment.
// A case therefore judges the same on every machine and in every repo.
import type { Fs, FsStat, Ports, Result } from "../../kernel/index.ts";
import {
	err,
	globMatch,
	makeError,
	notFoundError,
	ok,
} from "../../kernel/index.ts";

const CASE_INSTANT = "1970-01-01T00:00:00.000Z";

function normalize(path: string): string {
	const slashes = path.split("\\").join("/");
	const trimmed = slashes.replace(/\/+$/, "");
	return trimmed.startsWith("./") ? trimmed.slice(2) : trimmed;
}

function unavailable(what: string): Result<never> {
	return err(
		makeError(
			"CDX-E903",
			`${what} is unavailable while a pack case runs`,
			"A pack case may read only its own files; remove the dependency from the enforcer path.",
		),
	);
}

class CaseFs implements Fs {
	private readonly files = new Map<string, string>();

	constructor(files: Readonly<Record<string, string>>) {
		for (const [path, text] of Object.entries(files)) {
			this.files.set(normalize(path), text);
		}
	}

	private childNames(dir: string): Array<string> {
		const key = normalize(dir);
		const prefix = key === "" || key === "." ? "" : `${key}/`;
		const names = new Set<string>();
		for (const stored of this.files.keys()) {
			if (stored.startsWith(prefix)) {
				names.add(stored.slice(prefix.length).split("/")[0] ?? "");
			}
		}
		return [...names].sort();
	}

	read(path: string): Promise<Result<Uint8Array>> {
		const text = this.files.get(normalize(path));
		return Promise.resolve(
			text === undefined
				? err(notFoundError(path))
				: ok(new TextEncoder().encode(text)),
		);
	}

	readText(path: string): Promise<Result<string>> {
		const text = this.files.get(normalize(path));
		return Promise.resolve(
			text === undefined ? err(notFoundError(path)) : ok(text),
		);
	}

	write(path: string, content: Uint8Array): Promise<Result<void>> {
		this.files.set(normalize(path), new TextDecoder().decode(content));
		return Promise.resolve(ok(undefined));
	}

	append(path: string, content: Uint8Array): Promise<Result<void>> {
		const key = normalize(path);
		this.files.set(
			key,
			`${this.files.get(key) ?? ""}${new TextDecoder().decode(content)}`,
		);
		return Promise.resolve(ok(undefined));
	}

	stat(path: string): Promise<Result<FsStat>> {
		const text = this.files.get(normalize(path));
		if (text !== undefined) {
			return Promise.resolve(
				ok({
					isFile: true,
					isDirectory: false,
					size: new TextEncoder().encode(text).length,
				}),
			);
		}
		if (this.childNames(path).length > 0) {
			return Promise.resolve(ok({ isFile: false, isDirectory: true, size: 0 }));
		}
		return Promise.resolve(err(notFoundError(path)));
	}

	list(dir: string): Promise<Result<Array<string>>> {
		const names = this.childNames(dir);
		return Promise.resolve(
			names.length === 0 ? err(notFoundError(dir)) : ok(names),
		);
	}

	glob(pattern: string, dir: string): Promise<Result<Array<string>>> {
		const key = normalize(dir);
		const prefix = key === "" || key === "." ? "" : `${key}/`;
		const matched: Array<string> = [];
		for (const stored of this.files.keys()) {
			if (stored.startsWith(prefix)) {
				const rel = stored.slice(prefix.length);
				if (globMatch(pattern, rel)) {
					matched.push(stored);
				}
			}
		}
		return Promise.resolve(ok(matched.sort()));
	}

	exists(path: string): Promise<Result<boolean>> {
		const key = normalize(path);
		return Promise.resolve(
			ok(this.files.has(key) || this.childNames(key).length > 0),
		);
	}

	realpath(path: string): Promise<Result<string>> {
		return Promise.resolve(ok(normalize(path)));
	}

	remove(path: string): Promise<Result<void>> {
		this.files.delete(normalize(path));
		return Promise.resolve(ok(undefined));
	}
}

// SPEC §4.4.4: ports for one case; `files` maps repo-relative path to text.
export function casePorts(files: Readonly<Record<string, string>>): Ports {
	return {
		fs: new CaseFs(files),
		proc: {
			run: () =>
				Promise.resolve({
					code: 127,
					stdout: "",
					stderr: "no process runs while a pack case runs",
					timedOut: false,
					truncated: false,
				}),
		},
		net: { request: () => Promise.resolve(unavailable("the network")) },
		clock: { now: () => CASE_INSTANT },
		git: {
			root: () => Promise.resolve(unavailable("git")),
			head: () => Promise.resolve(unavailable("git")),
			stagedFiles: () => Promise.resolve(unavailable("git")),
			diff: () => Promise.resolve(unavailable("git")),
			show: () => Promise.resolve(unavailable("git")),
			config: () => Promise.resolve(unavailable("git")),
			log: () => Promise.resolve(unavailable("git")),
			isClean: () => Promise.resolve(unavailable("git")),
		},
		env: { get: () => undefined },
	};
}
