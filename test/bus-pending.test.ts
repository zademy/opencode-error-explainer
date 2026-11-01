import { describe, expect, it } from "vitest";

import { createPendingNotes } from "../src/bus/pending.js";

describe("createPendingNotes", () => {
  it("enqueue then drain returns the lines oldest-first", () => {
    const p = createPendingNotes();
    p.enqueue("s1", "line one");
    p.enqueue("s1", "line two");
    expect(p.drain("s1")).toEqual(["line one", "line two"]);
  });

  it("drain empties the queue for that session", () => {
    const p = createPendingNotes();
    p.enqueue("s1", "only");
    expect(p.drain("s1")).toEqual(["only"]);
    expect(p.drain("s1")).toEqual([]);
  });

  it("an identical line already queued is not re-enqueued", () => {
    const p = createPendingNotes();
    expect(p.enqueue("s1", "dup")).toBe(true);
    expect(p.enqueue("s1", "dup")).toBe(false);
    expect(p.drain("s1")).toEqual(["dup"]);
  });

  it("sessions are independent", () => {
    const p = createPendingNotes();
    p.enqueue("s1", "a");
    p.enqueue("s2", "b");
    expect(p.drain("s1")).toEqual(["a"]);
    expect(p.drain("s2")).toEqual(["b"]);
  });

  it("caps at 10 lines per session, dropping the newest beyond the cap", () => {
    const p = createPendingNotes();
    for (let i = 1; i <= 12; i++) p.enqueue("s1", `note ${i}`);
    const drained = p.drain("s1");
    expect(drained).toHaveLength(10);
    expect(drained[0]).toBe("note 1");
    expect(drained[9]).toBe("note 10");
  });

  it("re-enqueues lines freed by drain (dedup is per-queue, not forever)", () => {
    const p = createPendingNotes();
    p.enqueue("s1", "x");
    p.drain("s1");
    expect(p.enqueue("s1", "x")).toBe(true);
  });
});
