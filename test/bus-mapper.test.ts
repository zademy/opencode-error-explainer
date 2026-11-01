import { describe, expect, it } from "vitest";

import { createBusState, mapBusEvent } from "../src/bus/mapper.js";

const execFailed = {
  type: "session.execution.failed",
  properties: { sessionID: "s1", error: { message: "provider fetch failed" } },
};

describe("mapBusEvent — signal events", () => {
  it("maps session.execution.failed to a signal", () => {
    const eff = mapBusEvent(execFailed, createBusState());
    expect(eff).toHaveLength(1);
    expect(eff[0]?.type).toBe("signal");
    if (eff[0]?.type === "signal") {
      expect(eff[0].signal).toEqual({
        sessionID: "s1",
        kind: "execution-failed",
        command: "",
        text: "provider fetch failed",
        exitCode: null,
      });
    }
  });

  it("maps session.retry.scheduled to a retry signal", () => {
    const eff = mapBusEvent(
      {
        type: "session.retry.scheduled",
        properties: {
          sessionID: "s1",
          error: { message: "429 too many requests" },
          attempt: 2,
        },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "signal") {
      expect(eff[0].signal.kind).toBe("retry-scheduled");
      expect(eff[0].signal.text).toBe("429 too many requests");
    }
  });

  it("maps session.compaction.failed to a compaction signal", () => {
    const eff = mapBusEvent(
      {
        type: "session.compaction.failed",
        properties: {
          sessionID: "s2",
          error: { message: "could not summarize" },
        },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "signal") {
      expect(eff[0].signal.kind).toBe("compaction-failed");
    }
  });
});

describe("mapBusEvent — permissions", () => {
  it("buffers permission.asked and emits nothing", () => {
    const state = createBusState();
    const eff = mapBusEvent(
      {
        type: "permission.asked",
        properties: {
          sessionID: "s1",
          requestID: "r1",
          action: "bash",
          resources: ["/etc/hosts"],
        },
      },
      state,
    );
    expect(eff).toEqual([]);
    expect(state.permissionAsks.get("r1")).toBeDefined();
  });

  it("joins permission.replied reject with the buffer into a signal", () => {
    const state = createBusState();
    mapBusEvent(
      {
        type: "permission.asked",
        properties: {
          sessionID: "s1",
          requestID: "r1",
          action: "bash",
          resources: ["/etc/hosts"],
        },
      },
      state,
    );
    const eff = mapBusEvent(
      {
        type: "permission.replied",
        properties: { sessionID: "s1", requestID: "r1", reply: "reject" },
      },
      state,
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "signal") {
      expect(eff[0].signal.kind).toBe("permission-denied");
      expect(eff[0].signal.text).toBe("permission denied: bash /etc/hosts");
    }
    // buffer entry consumed
    expect(state.permissionAsks.get("r1")).toBeUndefined();
  });

  it("ignores permission.replied grant (once/always) — no signal", () => {
    const state = createBusState();
    mapBusEvent(
      {
        type: "permission.asked",
        properties: {
          sessionID: "s1",
          requestID: "r1",
          action: "bash",
          resources: ["/x"],
        },
      },
      state,
    );
    for (const reply of ["once", "always"]) {
      const eff = mapBusEvent(
        {
          type: "permission.replied",
          properties: { sessionID: "s1", requestID: "r1", reply },
        },
        state,
      );
      expect(eff).toEqual([]);
    }
  });

  it("drops permission.replied with no matching asked (buffer miss)", () => {
    const eff = mapBusEvent(
      {
        type: "permission.replied",
        properties: { sessionID: "s1", requestID: "ghost", reply: "reject" },
      },
      createBusState(),
    );
    expect(eff).toEqual([]);
  });
});

describe("mapBusEvent — shell", () => {
  it("session.shell.started emits a running breadcrumb", () => {
    const eff = mapBusEvent(
      {
        type: "session.shell.started",
        properties: { sessionID: "s1", command: "npm test" },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "breadcrumb") {
      expect(eff[0].status).toBe("running");
      expect(eff[0].command).toBe("npm test");
    }
  });

  it("session.shell.ended non-zero exit emits signal + error breadcrumb", () => {
    const eff = mapBusEvent(
      {
        type: "session.shell.ended",
        properties: {
          sessionID: "s1",
          command: "npm test",
          exitCode: 1,
          output: "line1\nError: cannot find module",
        },
      },
      createBusState(),
    );
    const signal = eff.find((e) => e.type === "signal");
    const crumb = eff.find((e) => e.type === "breadcrumb");
    expect(signal).toBeDefined();
    expect(crumb).toBeDefined();
    if (signal?.type === "signal") {
      expect(signal.signal.kind).toBe("shell-failed");
      expect(signal.signal.exitCode).toBe(1);
      expect(signal.signal.text).toContain("Error: cannot find module");
    }
    if (crumb?.type === "breadcrumb") expect(crumb.status).toBe("error");
  });

  it("caps shell signal text at the last 50 lines", () => {
    const long = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const eff = mapBusEvent(
      {
        type: "session.shell.ended",
        properties: {
          sessionID: "s1",
          command: "x",
          exitCode: 2,
          output: long,
        },
      },
      createBusState(),
    );
    const signal = eff.find((e) => e.type === "signal");
    if (signal?.type === "signal") {
      const lines = signal.signal.text.split("\n");
      expect(lines).toHaveLength(50);
      expect(lines[0]).toBe("line 30");
    }
  });

  it("session.shell.ended zero exit emits breadcrumb only", () => {
    const eff = mapBusEvent(
      {
        type: "session.shell.ended",
        properties: {
          sessionID: "s1",
          command: "npm test",
          exitCode: 0,
          output: "ok",
        },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    expect(eff[0]?.type).toBe("breadcrumb");
  });
});

describe("mapBusEvent — digest and malformed input", () => {
  it("session.created emits digest-pending once per session", () => {
    const state = createBusState();
    const one = mapBusEvent(
      { type: "session.created", properties: { sessionID: "s9" } },
      state,
    );
    const two = mapBusEvent(
      { type: "session.created", properties: { sessionID: "s9" } },
      state,
    );
    expect(one.filter((e) => e.type === "digest-pending")).toHaveLength(1);
    expect(two).toEqual([]);
  });

  it("drops malformed events silently (no properties, wrong types, null)", () => {
    const state = createBusState();
    expect(mapBusEvent(null, state)).toEqual([]);
    expect(mapBusEvent(undefined, state)).toEqual([]);
    expect(mapBusEvent(42, state)).toEqual([]);
    expect(mapBusEvent({ type: "session.execution.failed" }, state)).toEqual(
      [],
    );
    expect(
      mapBusEvent(
        { type: "session.execution.failed", properties: { sessionID: "s1" } },
        state,
      ),
    ).toEqual([]); // error.message missing
    expect(
      mapBusEvent(
        { type: "session.execution.failed", properties: { error: {} } },
        state,
      ),
    ).toEqual([]); // sessionID missing
  });

  it("ignores unknown event types", () => {
    expect(
      mapBusEvent(
        { type: "file.edited", properties: { sessionID: "s1" } },
        createBusState(),
      ),
    ).toEqual([]);
  });

  it("tolerates flat (unwrapped) event payloads defensively", () => {
    const eff = mapBusEvent(
      {
        type: "session.execution.failed",
        sessionID: "s1",
        error: { message: "flat shape" },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "signal") {
      expect(eff[0].signal.text).toBe("flat shape");
    }
  });
});
