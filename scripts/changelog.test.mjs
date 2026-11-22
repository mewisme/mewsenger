import { expect, test } from "vitest";
import { isNoise, parseCommit, renderChangelog, renderSection } from "./changelog.mjs";

test("commit subjects are grouped by type and scope", () => {
  expect(parseCommit("a1", "feat(tabs): keep Settings open")).toMatchObject({ group: "feat", scope: "tabs", text: "keep Settings open" });
  expect(parseCommit("a2", "fix: stop the flash")).toMatchObject({ group: "fix", scope: "" });
  expect(parseCommit("a3", "chore(repo): metadata").group).toBe("maintenance");
  expect(parseCommit("a4", "ci: cache").group).toBe("maintenance");
  expect(parseCommit("a5", "feat(api)!: drop it").breaking).toBe(true);
  expect(parseCommit("a6", "Update GITHUB_TOKEN in build.yml").group).toBe("other");
  expect(parseCommit("a7", "wip: later").group).toBe("other");
});

test("a section lists groups in a fixed order and skips release bookkeeping", () => {
  const section = renderSection({
    tag: "v0.3.0", previous: "v0.2.0", date: "2027-01-02",
    commits: [
      { hash: "b", subject: "fix(ui): flash" },
      { hash: "a", subject: "feat(chat): wide" },
      { hash: "c", subject: "chore(release): bump the version to 0.3.0" },
    ],
  });
  expect(section).toContain("## [0.3.0](https://github.com/mewisme/mewsenger/compare/v0.2.0...v0.3.0) - 2027-01-02");
  expect(section.indexOf("### Features")).toBeLessThan(section.indexOf("### Bug fixes"));
  expect(section).toContain("- **chat:** wide ([a](https://github.com/mewisme/mewsenger/commit/a))");
  expect(section).not.toContain("bump the version");
  expect(isNoise("docs(changelog): update for v1")).toBe(true);
  expect(isNoise("docs(readme): rewrite")).toBe(false);
});

test("the first release links to its tag, and an empty one says so", () => {
  expect(renderSection({ tag: "v0.1.0", previous: undefined, date: "2025-01-01", commits: [] }))
    .toContain("/releases/tag/v0.1.0) - 2025-01-01\n\nNo notable changes.");
  expect(renderChangelog(["## x\n"])).toMatch(/^# Changelog\n\n.*\n\n## x\n$/);
});
