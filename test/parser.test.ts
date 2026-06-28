import { describe, expect, it } from "vitest";

import {
  isInApp,
  packageOf,
  parseStacktrace,
  stackToLanguage,
  syntheticFrame,
} from "../src/trace/parser.js";

describe("stackToLanguage", () => {
  it("maps stacks to languages", () => {
    expect(stackToLanguage("node")).toBe("javascript");
    expect(stackToLanguage("typescript")).toBe("javascript");
    expect(stackToLanguage("python")).toBe("python");
    expect(stackToLanguage("java")).toBe("java");
    expect(stackToLanguage("rust")).toBe("rust");
    expect(stackToLanguage("go")).toBe("go");
    expect(stackToLanguage("docker")).toBeNull();
  });
});

describe("isInApp / packageOf", () => {
  it("marks vendor/stdlib paths as out-of-app", () => {
    expect(isInApp("/home/me/app/src/index.ts")).toBe(true);
    expect(isInApp("/x/node_modules/express/lib/index.js")).toBe(false);
    expect(
      isInApp("/x/.venv/lib/python3.11/site-packages/pkg/__init__.py"),
    ).toBe(false);
    expect(isInApp("node:internal/modules")).toBe(false);
  });

  it("extracts npm package name from node_modules paths", () => {
    expect(packageOf("/x/node_modules/express/lib/index.js")).toBe("express");
    expect(packageOf("/x/node_modules/@scope/pkg/lib/index.js")).toBe(
      "@scope/pkg",
    );
    expect(packageOf("/x/src/index.ts")).toBeNull();
  });
});

describe("parseStacktrace", () => {
  it("parses a JavaScript stack", () => {
    const out = [
      "Error: boom",
      "    at foo (/app/src/index.js:10:5)",
      "    at Object.<anonymous> (/app/node_modules/express/index.js:2:3)",
    ].join("\n");
    const frames = parseStacktrace(out, "javascript");
    expect(frames.length).toBe(2);
    expect(frames[0]!.function).toBe("foo");
    expect(frames[0]!.lineno).toBe(10);
    expect(frames[0]!.colno).toBe(5);
    expect(frames[0]!.in_app).toBe(true);
    expect(frames[1]!.in_app).toBe(false);
    expect(frames[1]!.module).toBe("express");
  });

  it("parses a Python traceback", () => {
    const out = [
      "Traceback (most recent call last):",
      '  File "/app/main.py", line 12, in <module>',
      "    run()",
    ].join("\n");
    const frames = parseStacktrace(out, "python");
    expect(frames.length).toBe(1);
    expect(frames[0]!.filename).toBe("/app/main.py");
    expect(frames[0]!.lineno).toBe(12);
    expect(frames[0]!.function).toBe("<module>");
  });

  it("parses a Java stack", () => {
    const out = [
      'Exception in thread "main" java.lang.NullPointerException',
      "\tat com.example.App.main(App.java:42)",
    ].join("\n");
    const frames = parseStacktrace(out, "java");
    expect(frames.length).toBe(1);
    expect(frames[0]!.function).toBe("com.example.App.main");
    expect(frames[0]!.filename).toBe("App.java");
    expect(frames[0]!.lineno).toBe(42);
  });

  it("parses a Rust panic location", () => {
    const out = "thread 'main' panicked at src/main.rs:42:10";
    const frames = parseStacktrace(out, "rust");
    expect(frames.length).toBe(1);
    expect(frames[0]!.filename).toBe("src/main.rs");
    expect(frames[0]!.lineno).toBe(42);
  });

  it("returns [] for an unknown language", () => {
    expect(parseStacktrace("Error: x", null)).toEqual([]);
  });
});

describe("syntheticFrame", () => {
  it("builds a frame from file:line", () => {
    const f = syntheticFrame("src/app.ts", 7);
    expect(f?.filename).toBe("src/app.ts");
    expect(f?.lineno).toBe(7);
    expect(f?.in_app).toBe(true);
  });
  it("returns null when nothing is available", () => {
    expect(syntheticFrame(undefined, undefined)).toBeNull();
  });
});
