import { readFile } from "node:fs/promises";
import { stdout } from "node:process";

const skillPath = ".agents/skills/issue-to-pr/SKILL.md";
const metadataPath = ".agents/skills/issue-to-pr/agents/openai.yaml";

const skill = await readFile(skillPath, "utf8");
const metadata = await readFile(metadataPath, "utf8");

if (!skill.startsWith("---\n") || !skill.includes("\n---\n")) {
  throw new Error(`${skillPath}: missing YAML front matter`);
}

const frontMatter = skill.slice(4, skill.indexOf("\n---\n"));
for (const key of ["name:", "description:"]) {
  if (!frontMatter.split("\n").some((line) => line.startsWith(key))) {
    throw new Error(`${skillPath}: missing front-matter ${key}`);
  }
}

const requiredMetadata = [
  "interface:",
  "  display_name:",
  "  short_description:",
  "  default_prompt:",
];
for (const line of requiredMetadata) {
  if (!metadata.split("\n").some((candidate) => candidate.startsWith(line))) {
    throw new Error(`${metadataPath}: missing ${line}`);
  }
}

if (!skill.includes("# Issue-to-PR") || !skill.includes("## Procedure")) {
  throw new Error(`${skillPath}: missing required Skill sections`);
}

stdout.write("Skill structure validation passed\n");
