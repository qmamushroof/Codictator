// SPEC §4.20.2 PR4: the Steering virtual document. A session's full
// injected text opens in a read-only virtual document under the
// `codictator-steering` scheme, never an editable file.
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
