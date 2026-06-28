import { describe, expect, it } from "vitest";

import { redactSecrets } from "../src/enrich/redact.js";

describe("redactSecrets", () => {
  it("passes through clean text unchanged", () => {
    expect(redactSecrets("everything is fine here")).toBe(
      "everything is fine here",
    );
  });

  it("redacts AWS access key ids", () => {
    expect(redactSecrets("using AKIAIOSFODNN7EXAMPLE now")).toBe(
      "using [REDACTED] now",
    );
  });

  it("redacts a PEM private key block entirely", () => {
    const input =
      "key: -----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA\n-----END RSA PRIVATE KEY-----";
    expect(redactSecrets(input)).not.toContain("MIIEpAIBAAKCAQEA");
    expect(redactSecrets(input)).toContain("[REDACTED]");
  });

  it("redacts GitHub tokens", () => {
    expect(redactSecrets("ghp_0123456789012345678901234567890abcdef")).toBe(
      "[REDACTED]",
    );
  });

  it("redacts the value of labeled secrets but keeps the label", () => {
    const out = redactSecrets("password=hunter2-secret-value-here");
    expect(out).toContain("password=");
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("hunter2-secret-value-here");
  });

  it("redacts Bearer tokens", () => {
    const out = redactSecrets(
      "Authorization: Bearer abcdef1234567890abcdef1234567890",
    );
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("abcdef1234567890abcdef1234567890");
  });

  it("redacts JWTs", () => {
    const jwt = "eyJhbGci.eyJzdWIi.SflKxwRJSMXW";
    expect(redactSecrets(`token=${jwt}`)).not.toContain(jwt);
  });

  it("handles empty input", () => {
    expect(redactSecrets("")).toBe("");
  });
});
