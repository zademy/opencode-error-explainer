import { describe, expect, it } from "vitest";

import { createBusState, mapBusEvent } from "../src/bus/mapper.js";

/**
 * Fixtures mirror the REAL V2Event envelopes emitted by @opencode/client
 * (verified against @opencode/plugin 2.2.5 generated types): payload fields
 * live under `data`, permission.asked carries `data.id`, shell info nests
 * under `data.shell`, and `session.shell.ended` output under `data.output`.
 */

const execFailed = {
  id: "evt-1",
  created: 1730000000000,
  type: "session.execution.failed",
  data: {
    sessionID: "s1",
    error: { type: "provider", message: "provider fetch failed" },
  },
};

describe("mapBusEvent — signal events (real envelope)", () => {
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
        ...execFailed,
        type: "session.retry.scheduled",
        data: {
          sessionID: "s1",
          assistantMessageID: "m1",
          attempt: 2,
          at: 1730000001000,
          error: { type: "rate_limited", message: "429 too many requests" },
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
        ...execFailed,
        type: "session.compaction.failed",
        data: {
          sessionID: "s2",
          reason: "auto",
          error: { type: "internal", message: "could not summarize" },
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

describe("mapBusEvent — permissions (asked.data.id ↔ replied.data.requestID)", () => {
  const asked = {
    id: "evt-a",
    created: 1,
    type: "permission.asked",
    data: {
      id: "perm-1",
      sessionID: "s1",
      action: "bash",
      resources: ["/etc/hosts"],
    },
  };

  it("buffers permission.asked (keyed by data.id) and emits nothing", () => {
    const state = createBusState();
    const eff = mapBusEvent(asked, state);
    expect(eff).toEqual([]);
    expect(state.permissionAsks.get("perm-1")).toBeDefined();
  });

  it("joins permission.replied reject (data.requestID) with the buffer", () => {
    const state = createBusState();
    mapBusEvent(asked, state);
    const eff = mapBusEvent(
      {
        id: "evt-b",
        created: 2,
        type: "permission.replied",
        data: { sessionID: "s1", requestID: "perm-1", reply: "reject" },
      },
      state,
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "signal") {
      expect(eff[0].signal.kind).toBe("permission-denied");
      expect(eff[0].signal.text).toBe("permission denied: bash /etc/hosts");
    }
    expect(state.permissionAsks.get("perm-1")).toBeUndefined();
  });

  it("ignores grants (once/always) — no signal, buffer drained", () => {
    const state = createBusState();
    mapBusEvent(asked, state);
    const eff = mapBusEvent(
      {
        type: "permission.replied",
        data: { sessionID: "s1", requestID: "perm-1", reply: "once" },
      },
      state,
    );
    expect(eff).toEqual([]);
    expect(state.permissionAsks.get("perm-1")).toBeUndefined();
  });

  it("drops permission.replied with no matching asked (buffer miss)", () => {
    expect(
      mapBusEvent(
        {
          type: "permission.replied",
          data: { sessionID: "s1", requestID: "ghost", reply: "reject" },
        },
        createBusState(),
      ),
    ).toEqual([]);
  });

  it("prunes stale unanswered permission asks beyond 50", () => {
    const state = createBusState();
    for (let i = 0; i < 60; i++) {
      mapBusEvent(
        {
          type: "permission.asked",
          data: { id: `p${i}`, sessionID: "s1", action: "bash", resources: [] },
        },
        state,
      );
    }
    expect(state.permissionAsks.size).toBeLessThanOrEqual(50);
    expect(state.permissionAsks.has("p0")).toBe(false);
    expect(state.permissionAsks.has("p59")).toBe(true);
  });
});

describe("mapBusEvent — shell (data.shell + data.output)", () => {
  const shellEnded = (shell: Record<string, unknown>, output = "") => ({
    id: "evt-s",
    created: 3,
    type: "session.shell.ended",
    data: {
      sessionID: "s1",
      shell: {
        id: "sh-1",
        status: "exited",
        command: "npm test",
        exit: 1,
        ...shell,
      },
      output: { output, cursor: 0, size: 0, truncated: false },
    },
  });

  it("session.shell.started emits a running breadcrumb", () => {
    const eff = mapBusEvent(
      {
        type: "session.shell.started",
        data: {
          sessionID: "s1",
          shell: { id: "sh-1", status: "running", command: "npm test" },
        },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    if (eff[0]?.type === "breadcrumb") {
      expect(eff[0].status).toBe("running");
      expect(eff[0].command).toBe("npm test");
    }
  });

  it("non-zero exit emits signal + error breadcrumb", () => {
    const eff = mapBusEvent(
      shellEnded({}, "line1\nError: cannot find module"),
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

  it("status timeout/killed is a failure even without an exit code", () => {
    for (const status of ["timeout", "killed"] as const) {
      const eff = mapBusEvent(
        shellEnded({ status, exit: undefined }, "took too long"),
        createBusState(),
      );
      expect(eff.find((e) => e.type === "signal")).toBeDefined();
    }
  });

  it("zero exit emits breadcrumb only", () => {
    const eff = mapBusEvent(shellEnded({ exit: 0 }, "ok"), createBusState());
    expect(eff).toHaveLength(1);
    expect(eff[0]?.type).toBe("breadcrumb");
    if (eff[0]?.type === "breadcrumb") expect(eff[0].status).toBe("ok");
  });

  it("caps shell signal text at the last 50 lines", () => {
    const long = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n");
    const eff = mapBusEvent(shellEnded({}, long), createBusState());
    const signal = eff.find((e) => e.type === "signal");
    if (signal?.type === "signal") {
      expect(signal.signal.text.split("\n")).toHaveLength(50);
      expect(signal.signal.text.split("\n")[0]).toBe("line 30");
    }
  });
});

describe("mapBusEvent — digest and malformed input", () => {
  it("session.created emits digest-pending once per session", () => {
    const state = createBusState();
    const one = mapBusEvent(
      { type: "session.created", data: { sessionID: "s9", slug: "x" } },
      state,
    );
    const two = mapBusEvent(
      { type: "session.created", data: { sessionID: "s9", slug: "x" } },
      state,
    );
    expect(one.filter((e) => e.type === "digest-pending")).toHaveLength(1);
    expect(two).toEqual([]);
  });

  it("drops malformed events silently", () => {
    const state = createBusState();
    expect(mapBusEvent(null, state)).toEqual([]);
    expect(mapBusEvent(undefined, state)).toEqual([]);
    expect(mapBusEvent(42, state)).toEqual([]);
    expect(mapBusEvent({ type: "session.execution.failed" }, state)).toEqual(
      [],
    );
    expect(
      mapBusEvent(
        { type: "session.execution.failed", data: { sessionID: "s1" } },
        state,
      ),
    ).toEqual([]);
    expect(
      mapBusEvent(
        { type: "session.execution.failed", data: { error: {} } },
        state,
      ),
    ).toEqual([]);
    expect(
      mapBusEvent(
        { type: "session.shell.ended", data: { sessionID: "s1" } },
        state,
      ),
    ).toEqual([]);
  });

  it("ignores unknown event types", () => {
    expect(
      mapBusEvent(
        { type: "file.edited", data: { sessionID: "s1" } },
        createBusState(),
      ),
    ).toEqual([]);
  });

  it("tolerates legacy/flat payload shapes defensively", () => {
    // properties dialect (pre-2.2 assumption) still maps
    const eff = mapBusEvent(
      {
        type: "session.execution.failed",
        properties: { sessionID: "s1", error: { message: "legacy shape" } },
      },
      createBusState(),
    );
    expect(eff).toHaveLength(1);
    // flat dialect too
    const flat = mapBusEvent(
      {
        type: "session.execution.failed",
        sessionID: "s1",
        error: { message: "flat shape" },
      },
      createBusState(),
    );
    expect(flat).toHaveLength(1);
    if (flat[0]?.type === "signal") {
      expect(flat[0].signal.text).toBe("flat shape");
    }
  });
});
