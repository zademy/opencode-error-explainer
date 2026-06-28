import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enrichFrames } from "../src/context/source.js";
import type { Frame } from "../src/event/types.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ee-src-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function frame(filename: string, lineno: number, in_app: boolean): Frame {
  return {
    filename,
    function: "fn",
    lineno,
    colno: null,
    in_app,
    context: null,
    module: null,
  };
}

describe("enrichFrames", () => {
  it("attaches source context around the error line for in-app frames", async () => {
    const file = join(dir, "app.ts");
    await writeFile(
      file,
      ["a", "b", "c", "d", "e", "f", "g"].join("\n"),
      "utf8",
    );
    const out = await enrichFrames([frame("app.ts", 4, true)], dir, 2);
    const ctx = out[0]!.context!;
    expect(ctx.some((c) => c.line === 4 && c.source === "d")).toBe(true);
    expect(ctx.length).toBe(5); // lines 2..6
  });

  it("skips external (node_modules) frames", async () => {
    const out = await enrichFrames(
      [frame("node_modules/x/index.js", 3, false)],
      dir,
      2,
    );
    expect(out[0]!.context).toBeNull();
  });

  it("returns null context when the file is missing", async () => {
    const out = await enrichFrames([frame("missing.ts", 1, true)], dir, 2);
    expect(out[0]!.context).toBeNull();
  });

  it("skips binary files", async () => {
    const file = join(dir, "bin");
    const buf = Buffer.alloc(64, 0);
    buf[0] = 0x00;
    await mkdir(dir, { recursive: true });
    await writeFile(file, buf);
    const out = await enrichFrames([frame("bin", 1, true)], dir, 2);
    expect(out[0]!.context).toBeNull();
  });
});
