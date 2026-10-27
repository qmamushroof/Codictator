// SPEC §10.2: an in-memory Git port for unit tests (SPEC §4.1.1). State is
// seeded per test and never touches a real repo; unset text queries answer
// empty. Kernel failures are simulated with failNext and a real SPEC §8 error.
import type { CdxError, Git, Result } from "../../src/kernel/index.ts";

export class FakeGit implements Git {
	private rootValue = "/repo";
	private headValue = "0123456789abcdef0123456789abcdef01234567";
	private stagedValue: Array<string> = [];
	private readonly diffs = new Map<string, string>();
	private readonly shows = new Map<string, string>();
	private readonly configs = new Map<string, string>();
	private readonly logs = new Map<string, string>();
	private cleanValue = true;
	private pending: CdxError | undefined;

	failNext(error: CdxError): void {
		this.pending = error;
	}

	private nextFailure(): Result<never> | undefined {
		const failure = this.pending;
		this.pending = undefined;
		return failure === undefined ? undefined : { ok: false, error: failure };
	}

	setRoot(root: string): void {
		this.rootValue = root;
	}

	setHead(head: string): void {
		this.headValue = head;
	}

	setStaged(files: ReadonlyArray<string>): void {
		this.stagedValue = [...files];
	}

	setDiff(base: string, head: string, diff: string): void {
		this.diffs.set(`${base}..${head}`, diff);
	}

	setShow(rev: string, path: string, content: string): void {
		this.shows.set(`${rev}:${path}`, content);
	}

	setConfig(key: string, value: string): void {
		this.configs.set(key, value);
	}

	setLog(range: string, log: string): void {
		this.logs.set(range, log);
	}

	setClean(clean: boolean): void {
		this.cleanValue = clean;
	}

	root(): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({ ok: true, value: this.rootValue });
	}

	head(): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({ ok: true, value: this.headValue });
	}

	stagedFiles(): Promise<Result<Array<string>>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<Array<string>>>({
			ok: true,
			value: [...this.stagedValue].sort(),
		});
	}

	diff(base: string, head: string): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({
			ok: true,
			value: this.diffs.get(`${base}..${head}`) ?? "",
		});
	}

	show(rev: string, path: string): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({
			ok: true,
			value: this.shows.get(`${rev}:${path}`) ?? "",
		});
	}

	config(key: string): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({
			ok: true,
			value: this.configs.get(key) ?? "",
		});
	}

	log(range: string): Promise<Result<string>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<string>>({
			ok: true,
			value: this.logs.get(range) ?? "",
		});
	}

	isClean(): Promise<Result<boolean>> {
		const failure = this.nextFailure();
		if (failure !== undefined) {
			return Promise.resolve(failure);
		}
		return Promise.resolve<Result<boolean>>({
			ok: true,
			value: this.cleanValue,
		});
	}
}
