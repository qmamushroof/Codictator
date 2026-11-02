// SPEC §4.1.2: kernel barrel for the flat key readers. TOML parsing lives
// in config-toml-keys.ts, YAML parsing in config-yaml-keys.ts; this file
// only re-exports them so the kernel index surface is unchanged.
export { readTomlKeys } from "./config-toml-keys.ts";
export { readYamlKeys } from "./config-yaml-keys.ts";
