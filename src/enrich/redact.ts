/**
 * Best-effort secret redaction.
 *
 * Applied to any output before it is written to disk, so a debugging artifact
 * never leaks credentials. This is intentionally conservative: it prefers false
 * positives (replacing something harmless) over false negatives (leaking a key).
 *
 * NOTE: this only covers PERSISTED artifacts. The live `output.output` the AI
 * sees in-session is left untouched so the model can still reason about the real
 * command — redaction is a write-to-disk concern only.
 */

import type { RedactionRule } from "../classify/types.js";

export const REDACTION_RULES: readonly RedactionRule[] = [
  // AWS access key id (20 chars, AKIA prefix)
  { id: "aws_access_key_id", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  // AWS secret access key (40 base64-ish), only when labelled
  {
    id: "aws_secret",
    pattern:
      /\b(?:aws_secret_access_key|aws_secret)["':=\s]+([A-Za-z0-9/+=]{40})\b/g,
  },
  // Google / GCP service account private key block (entire PEM)
  {
    id: "gcp_pem",
    pattern:
      /-----BEGIN (?:[A-Z ]*)PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]*)PRIVATE KEY-----/g,
  },
  // Generic PEM private key
  {
    id: "pem_private_key",
    pattern: /-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----/g,
  },
  // GitHub tokens (classic + fine-grained). Real classic PATs are exactly 36
  // chars after `ghp_`; allow `{36,}` so a format change doesn't silently miss.
  {
    id: "github_pat",
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  // Slack tokens
  { id: "slack_token", pattern: /\bxox[abp]-[A-Za-z0-9-]{10,}\b/g },
  // JWT (three base64url segments, min length to reduce false noise)
  {
    id: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  },
  // Generic Bearer token
  { id: "bearer", pattern: /\bBearer\s+[A-Za-z0-9._\-]{16,}/gi },
  // key=value style secrets: password=, passwd=, secret=, token=, api_key=, apikey=, access_token=
  {
    id: "labeled_secret",
    pattern:
      /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?token|private[_-]?key)(?:["']?\s*[:=]\s*["']?)([^\s"']+)/gi,
  },
  // Generic hex/base64 secrets of length 32+, ONLY when preceded by a secret-ish label
  {
    id: "authorization_header",
    pattern:
      /(?:Authorization|X-Api-Key)["']?\s*:\s*["']?([A-Za-z0-9._\-/+=]{24,})["']?/gi,
  },
];

const PLACEHOLDER = "[REDACTED]";

/**
 * Replace anything matching a redaction rule with `[REDACTED]`.
 *
 * For labeled-secrets (key=value), only the VALUE is redacted so the label
 * stays readable (`password=[REDACTED]`); for token-shaped matches the whole
 * token is replaced.
 */
export function redactSecrets(input: string): string {
  if (!input) return input;
  let out = input;
  for (const rule of REDACTION_RULES) {
    // Regexes use the global flag; reset lastIndex implicitly via String.replace.
    out = out.replace(rule.pattern, (match, group1) => {
      if (typeof group1 === "string" && group1.length > 0) {
        return match.replace(group1, PLACEHOLDER);
      }
      return PLACEHOLDER;
    });
  }
  return out;
}
