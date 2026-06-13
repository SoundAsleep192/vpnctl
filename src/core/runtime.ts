const BUN_COMPILED_BINARY_VIRTUAL_ROOT = "/$bunfs";

export function isCompiledBinary(): boolean {
  return import.meta.dir.startsWith(BUN_COMPILED_BINARY_VIRTUAL_ROOT);
}
