import { describe, expect, test } from "bun:test";
import { isCompiledBinary } from "../src/core/runtime";

describe("isCompiledBinary", () => {
  test("returns false when running from source via bun", () => {
    expect(isCompiledBinary()).toBe(false);
  });
});
