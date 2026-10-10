/**
 * Single source of truth for the published version.
 *
 * Keep in sync with the `version` field in package.json. It is intentionally a
 * literal (not read from package.json at runtime) so the bundled plugin does
 * not depend on its install layout to know its own version.
 */
export const VERSION = "0.3.1";
