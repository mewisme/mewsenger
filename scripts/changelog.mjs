#!/usr/bin/env node
// Builds CHANGELOG.md from the Conventional Commit subjects between version
// tags. Before tagging, `--write` adds the coming version (package.json) to
// the file; the release workflow uses `--tag` for the release notes.
//
//   node scripts/changelog.mjs --write        CHANGELOG.md, with the version in package.json
//   node scripts/changelog.mjs --tag v1.2.3   notes of one release
//   node scripts/changelog.mjs --all          the whole file, released versions only
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const REPO = "https://github.com/mewisme/mewsenger";

const GROUPS = [
  ["feat", "Features"],
  ["fix", "Bug fixes"],
  ["perf", "Performance"],
  ["refactor", "Refactoring"],
  ["docs", "Documentation"],
  ["maintenance", "Maintenance"],
  ["other", "Other changes"],
];
const MAINTENANCE = new Set(["chore", "ci", "build", "test", "style", "revert"]);

/** `type(scope)!: subject` into its parts; anything else is "other". */
export function parseCommit(hash, subject) {
  const match = /^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/.exec(subject);
  if (!match) return { hash, group: "other", scope: "", breaking: false, text: subject };
  const [, type, scope = "", bang, text] = match;
  const group = GROUPS.some(([key]) => key === type) && type !== "maintenance" && type !== "other"
    ? type
    : MAINTENANCE.has(type) ? "maintenance" : "other";
  return { hash, group, scope, breaking: Boolean(bang), text };
}

/** Version bumps and changelog refreshes are not news. */
export function isNoise(subject) {
  return /^(chore|docs)\((release|changelog)\):/.test(subject);
}

export function renderSection({ tag, previous, date, commits }) {
  const version = tag.replace(/^v/, "");
  const heading = previous
    ? `## [${version}](${REPO}/compare/${previous}...${tag}) - ${date}`
    : `## [${version}](${REPO}/releases/tag/${tag}) - ${date}`;
  const parsed = commits.filter(({ subject }) => !isNoise(subject)).map(({ hash, subject }) => parseCommit(hash, subject));
  const lines = [heading, ""];
  for (const [key, title] of GROUPS) {
    const items = parsed.filter((commit) => commit.group === key);
    if (items.length === 0) continue;
    lines.push(`### ${title}`, "");
    for (const { hash, scope, breaking, text } of items) {
      const prefix = scope ? `**${scope}:** ` : "";
      lines.push(`- ${breaking ? "**BREAKING** " : ""}${prefix}${text} ([${hash}](${REPO}/commit/${hash}))`);
    }
    lines.push("");
  }
  if (lines.length === 2) lines.push("No notable changes.", "");
  return lines.join("\n");
}

export function renderChangelog(sections) {
  return `# Changelog\n\nGenerated from the commit history by `pnpm changelog` when a release is prepared.\n\n${sections.join("\n")}`.replace(/\n+$/, "\n");
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

/** Version tags, newest first. */
export function versionTags() {
  return git("tag", "--list", "v[0-9]*", "--sort=-v:refname").split("\n").filter(Boolean);
}

function sectionOf(tag, previous, ref = tag) {
  const range = previous ? `${previous}..${ref}` : ref;
  const commits = git("log", range, "--no-merges", "--format=%h%x09%s")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, ...rest] = line.split("\t");
      return { hash, subject: rest.join("\t") };
    });
  return renderSection({ tag, previous, date: git("log", "-1", "--format=%cs", ref), commits });
}

if (process.argv[1] && basename(process.argv[1]) === "changelog.mjs") {
  const [mode, tag] = process.argv.slice(2);
  const tags = versionTags();
  if (mode === "--write") {
    const upcoming = `v${JSON.parse(readFileSync("package.json", "utf8")).version}`;
    const sections = tags.map((name, index) => sectionOf(name, tags[index + 1]));
    // A version that is not tagged yet takes the commits since the last tag.
    if (!tags.includes(upcoming)) sections.unshift(sectionOf(upcoming, tags[0], "HEAD"));
    writeFileSync("CHANGELOG.md", renderChangelog(sections));
  } else if (mode === "--all") {
    process.stdout.write(renderChangelog(tags.map((name, index) => sectionOf(name, tags[index + 1]))));
  } else if (mode === "--tag" && tag && tags.includes(tag)) {
    process.stdout.write(sectionOf(tag, tags[tags.indexOf(tag) + 1]));
  } else {
    console.error("usage: changelog.mjs --write | --all | --tag <existing vX.Y.Z tag>");
    process.exit(2);
  }
}
