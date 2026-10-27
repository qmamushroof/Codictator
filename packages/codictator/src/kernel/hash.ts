// SPEC §4.1.2: CRLF and CR become LF before hashing, so Git's autocrlf
// cannot fake drift (§4.14). Every content hash in §7 normalizes first.
import { createHash } from "node:crypto";

export function normalizeText(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function sha256Hex(bytes: Uint8Array): string {
	return createHash("sha256").update(bytes).digest("hex");
}

export function sha256Text(text: string): string {
	return sha256Hex(new TextEncoder().encode(normalizeText(text)));
}
