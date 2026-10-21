#!/usr/bin/env node
/**
 * Automated Relative Link & Anchor Validation Script
 * Scans all Markdown files in the repository to ensure all relative file paths
 * and target section anchors exist.
 */

const fs = require("fs");
const path = require("path");

function getMarkdownFiles(dir) {
  let files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name !== ".git" && item.name !== "node_modules") {
        files.push(...getMarkdownFiles(fullPath));
      }
    } else if (item.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function stripCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, "");
}

function extractHeaders(content) {
  const clean = stripCodeBlocks(content);
  const headerRegex = /^#{1,6}\s+(.+)$/gm;
  const headers = new Set();
  let match;
  while ((match = headerRegex.exec(clean)) !== null) {
    const rawTitle = match[1].trim();
    const stripped = rawTitle
      .toLowerCase()
      .replace(/[`~!@#$%^&*()+=|{}[\]:;"'<>,.?\\/]/g, "");
    // GitHub markdown anchor slug generation:
    headers.add(stripped.replace(/ /g, "-"));
    headers.add(stripped.replace(/\s+/g, "-"));
  }
  return headers;
}

const mdFiles = getMarkdownFiles(".");
let hasErrors = false;
console.log(`Scanning ${mdFiles.length} markdown files for relative links...`);

const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

for (const file of mdFiles) {
  const rawContent = fs.readFileSync(file, "utf8");
  const content = stripCodeBlocks(rawContent);
  const headers = extractHeaders(rawContent);
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const rawUrl = match[2].trim();
    if (
      rawUrl.startsWith("http://") ||
      rawUrl.startsWith("https://") ||
      rawUrl.startsWith("mailto:")
    ) {
      continue;
    }

    if (rawUrl.startsWith("#")) {
      // In-page anchor validation
      const anchor = rawUrl.slice(1);
      if (!headers.has(anchor)) {
        console.error(`❌ Broken anchor in ${file}: In-page anchor "#${anchor}" not found in headers.`);
        hasErrors = true;
      }
      continue;
    }

    const [filePathPart, anchorPart] = rawUrl.split("#");
    const cleanPath = filePathPart.split("?")[0];

    if (!cleanPath) continue;

    const resolved = path.resolve(path.dirname(file), cleanPath);
    if (!fs.existsSync(resolved)) {
      console.error(`❌ Broken link in ${file}: "${rawUrl}" -> Target not found: ${resolved}`);
      hasErrors = true;
    } else if (anchorPart && cleanPath.endsWith(".md")) {
      // Cross-page anchor validation
      const targetContent = fs.readFileSync(resolved, "utf8");
      const targetHeaders = extractHeaders(targetContent);
      if (!targetHeaders.has(anchorPart)) {
        console.error(`❌ Broken anchor in ${file}: Cross-file anchor "#${anchorPart}" not found in ${cleanPath}.`);
        hasErrors = true;
      }
    }
  }
}

if (hasErrors) {
  console.error("\n❌ Documentation link validation failed!");
  process.exit(1);
} else {
  console.log("\n✅ All relative documentation links and anchors verified successfully.");
}
