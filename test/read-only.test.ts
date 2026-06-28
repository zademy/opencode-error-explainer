import { describe, expect, it } from "vitest";

import { commandHead, isReadOnlyCommand } from "../src/classify/read-only.js";

describe("commandHead", () => {
  it("extracts the first meaningful token", () => {
    expect(commandHead("grep -i error log.txt")).toBe("grep");
    expect(commandHead("cat foo.log")).toBe("cat");
  });
  it("strips sudo and env assignments", () => {
    expect(commandHead("FOO=bar sudo grep x")).toBe("grep");
  });
  it("stops at the first pipe / &&", () => {
    expect(commandHead("cat log | grep error")).toBe("cat");
    expect(commandHead("node app && echo done")).toBe("node");
  });
  it("returns '' for empty", () => {
    expect(commandHead("")).toBe("");
  });
});

describe("isReadOnlyCommand", () => {
  const ro = ["cat", "grep", "rg", "less", "head", "tail", "find", "ls"];

  it("flags read-only inspection commands", () => {
    expect(isReadOnlyCommand("grep -i error app.log", ro)).toBe(true);
    expect(isReadOnlyCommand("cat /var/log/syslog", ro)).toBe(true);
    expect(isReadOnlyCommand("rg --color never ERROR .", ro)).toBe(true);
  });
  it("does not flag failing commands", () => {
    expect(isReadOnlyCommand("node app.js", ro)).toBe(false);
    expect(isReadOnlyCommand("npm run build", ro)).toBe(false);
    expect(isReadOnlyCommand("mvn clean install", ro)).toBe(false);
  });

  // ── Compound commands (all-segments check) ───────────────────────────────
  it("does NOT skip compound commands where a segment can fail", () => {
    // `grep x && npm test` — grep is read-only but npm test can fail.
    expect(isReadOnlyCommand("grep -i error app.log && npm test", ro)).toBe(
      false,
    );
    expect(isReadOnlyCommand("cat log | node process.js", ro)).toBe(false);
    expect(isReadOnlyCommand("ls; npm run build", ro)).toBe(false);
  });

  it("skips compound commands only when ALL segments are read-only", () => {
    expect(isReadOnlyCommand("grep error | head -5", ro)).toBe(true);
    expect(isReadOnlyCommand("ls && cat log", ro)).toBe(true);
    expect(isReadOnlyCommand("find . -name x; grep y", ro)).toBe(true);
  });
});
