export function legacyGreet(name: string): string {
	const prefix = "hello";
	return `${prefix} ${name}`;
}

export function legacyGreetLoud(name: string): string {
	const prefix = "hello";
	return `${prefix} ${name}`.toUpperCase();
}
