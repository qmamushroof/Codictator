// SPEC §4.11.1–§4.11.2: architecture profiles surface. Behaviour lives in
// arch-profiles, layer-rules, codictator-modules and module-map-validation;
// this file re-exports the surface so existing `./profiles.ts` imports keep
// working.
export {
	ARCH_PROFILES,
	type ArchProfile,
	isArchProfile,
} from "./arch-profiles.ts";
export {
	CODICTATOR_MODULES,
	CODICTATOR_PROFILE,
} from "./codictator-modules.ts";
export { layerMayImport, resolveLayer } from "./layer-rules.ts";
export { validateModuleMap } from "./module-map-validation.ts";
