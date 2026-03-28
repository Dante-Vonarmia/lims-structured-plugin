#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const configDir = path.join(root, "backend", "app", "static", "js", "core", "config");
const constantsDir = path.join(configDir, "constants");
const constantsEntry = path.join(configDir, "constants.js");

function fail(message) {
  console.error(`[constants-lint] ${message}`);
  process.exitCode = 1;
}

if (!fs.existsSync(constantsDir)) {
  fail(`Missing directory: ${constantsDir}`);
  process.exit(process.exitCode ?? 1);
}

if (!fs.existsSync(constantsEntry)) {
  fail(`Missing file: ${constantsEntry}`);
  process.exit(process.exitCode ?? 1);
}

const allowedRootFiles = new Set(["README.md"]);
const rootEntries = fs.readdirSync(constantsDir, { withFileTypes: true });
for (const entry of rootEntries) {
  if (entry.isFile() && !allowedRootFiles.has(entry.name)) {
    fail(`Flat constants file is not allowed in constants/: ${entry.name}`);
  }
}

const constantsSource = fs.readFileSync(constantsEntry, "utf8");
const exportLines = constantsSource
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.startsWith("export * from "));

if (!exportLines.length) {
  fail("No re-export lines found in constants.js");
}

for (const line of exportLines) {
  const match = line.match(/^export \* from ["'](.+)["'];?$/);
  if (!match) {
    fail(`Invalid re-export line in constants.js: ${line}`);
    continue;
  }
  const importPath = match[1];
  if (!importPath.startsWith("./constants/")) {
    fail(`Re-export must stay under ./constants/: ${line}`);
    continue;
  }
  const resolved = path.resolve(configDir, importPath);
  if (!fs.existsSync(resolved)) {
    fail(`Re-export target does not exist: ${importPath}`);
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log("[constants-lint] OK");
