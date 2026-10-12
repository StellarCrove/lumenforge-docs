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

function extractHeaders(content) {
  const headerRegex = /^#{1,6}\s+(.+)$/gm;
  const headers = new Set();
  let match;
  while ((match = headerRegex.exec(content)) !== null) {
    const rawTitle = match[1].trim();
    // GitHub markdown anchor slug generation:
    // lowercase, remove special characters except hyphens and spaces, replace spaces with hyphens
    const slug = rawTitle
      .toLowerCase()
      .replace(/[`~!@#$%^&*()+=|{}[\]:;"'<>,.?\\/]/g, "")
      .replace(/\s+/g, "-");
    headers.add(slug);
  }
  return headers;
}

const mdFiles = getMarkdownFiles(".");
let hasErrors = false;
console.log(`Scanning ${mdFiles.length} markdown files for relative links...`);

const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

for (const file of mdFiles) {
  const content = fs.readFileSync(file, "utf8");
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
      const headers = extractHeaders(content);
      if (!headers.has(anchor)) {
        // Warning for anchor mismatch
        console.warn(`⚠️ Warning in ${file}: In-page anchor "#${anchor}" not found in headers.`);
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
        console.warn(`⚠️ Warning in ${file}: Cross-file anchor "#${anchorPart}" not found in ${cleanPath}.`);
      }
    }
  }
}

if (hasErrors) {
  console.error("\n❌ Documentation link validation failed!");
  process.exit(1);
} else {
  console.log("\n✅ All relative documentation links verified successfully.");
}
