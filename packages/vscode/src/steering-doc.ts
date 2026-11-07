// SPEC §4.20.2 PR4: the Steering virtual document. A session's full
// injected text opens in a read-only virtual document under the
// `codictator-steering` scheme, never an editable file.
import { type EngineRequest, fieldOf, isRecord } from "./engine-client.ts";
import { listSteeringEntries } from "./p1-views.ts";
export const steeringScheme = "codictator-steering";

// SPEC §4.20.2 PR4: the document uri for a steering session.
export function injectionUri(sessionId: string): string {
	return `${steeringScheme}:${sessionId}`;
}

export interface SteeringDocProvider {
	provideTextDocumentContent(uri: string): string | undefined;
}

export interface SteeringDocPorts {
	registerContentProvider(scheme: string, provider: SteeringDocProvider): void;
}

// SPEC §4.20.2 PR4: the per-session injected-text store. State passes
// explicitly through the created store — no module-level mutable state
// (CONVENTIONS.md). The document is read-only: only content is provided,
// nothing writes it back.
export function createSteeringDocStore(): {
	readonly scheme: string;
	setSession(sessionId: string, text: string): void;
	contentFor(uri: string): string | undefined;
	provider(): SteeringDocProvider;
} {
	const texts = new Map<string, string>();
	const store = {
		contentFor: (uri: string): string | undefined => {
			const prefix = `${steeringScheme}:`;
			if (!uri.startsWith(prefix)) {
				return undefined;
			}
			return texts.get(uri.slice(prefix.length));
		},
		provider: (): SteeringDocProvider => ({
			provideTextDocumentContent: (uri: string): string | undefined =>
				store.contentFor(uri),
		}),
		scheme: steeringScheme,
		setSession: (sessionId: string, text: string): void => {
			texts.set(sessionId, text);
		},
	};
	return store;
}

// SPEC §4.20.2 PR4: register the read-only content provider for the store.
export function registerSteeringDoc(
	ports: SteeringDocPorts,
	store: { provider(): SteeringDocProvider; readonly scheme: string },
): void {
	ports.registerContentProvider(store.scheme, store.provider());
}

// SPEC §4.20.2 PR4: the steering texts behind the read-only virtual
// document, one entry per session with engine-reported text.
export async function fillSteeringDocs(
	store: { setSession(sessionId: string, text: string): void },
	folders: ReadonlyArray<string>,
	request?: EngineRequest,
): Promise<void> {
	for (const folder of folders) {
		for (const entry of await listSteeringEntries(folder, request)) {
			if (entry.text !== undefined) {
				store.setSession(entry.sessionId, entry.text);
			}
		}
	}
}

// SPEC §4.20.2 PR4: the host seam behind registerSteeringDoc. The host
// TextDocumentContentProvider narrows to the provide function; the store
// stays the source of truth.
export function steeringDocPortsOf(
	host: unknown,
): SteeringDocPorts | undefined {
	if (!isRecord(host)) {
		return undefined;
	}
	const workspace = fieldOf(host, "workspace");
	if (!isRecord(workspace)) {
		return undefined;
	}
	const register = fieldOf(workspace, "registerTextDocumentContentProvider");
	if (typeof register !== "function") {
		return undefined;
	}
	return {
		registerContentProvider: (
			scheme: string,
			provider: SteeringDocProvider,
		): void => {
			try {
				register(scheme, {
					provideTextDocumentContent: (uri: unknown): string | undefined =>
						typeof uri === "string"
							? provider.provideTextDocumentContent(uri)
							: undefined,
				});
			} catch {
				// Registration never blocks activation.
			}
		},
	};
}
