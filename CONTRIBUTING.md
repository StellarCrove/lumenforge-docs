# Contributing to LumenForge Documentation

Thank you for helping improve the documentation for **LumenForge** — the production-grade Soroban vault and custody protocol on Stellar.

---

## Repository Overview

`lumenforge-docs` serves as the authoritative, cross-repository documentation suite for:
- `StellarCrove/lumenforge-contracts`: Soroban smart contracts (`lumen_vault`, `lumen_vault_factory`).
- `StellarCrove/lumenforge-sdk`: TypeScript client SDK.
- `StellarCrove/lumenforge-docs`: Architecture, integration guides, data models, and API specifications.

---

## Guidelines for Contributions

### 1. Accuracy and Verification
- Documentation in this repository is verified directly against contract sources and SDK implementations. Avoid behavioral guesswork.
- If introducing changes related to contract mechanics (e.g. error codes, event topics, TTL policies), reference the corresponding ADR or code commit in `lumenforge-contracts`.

### 2. Markdown Style and Conventions
- Use standard GitHub Flavored Markdown.
- Ensure all relative document links are verified before submitting PRs.
- In-document anchors should match header slugs exactly.
- Prefer explicit tables and concrete examples with real numbers over high-level generalizations.

### 3. Link Integrity Verification
Before opening a pull request, verify that no relative links are broken:
```bash
node -e '
const fs = require("fs");
const path = require("path");

function getFiles(dir) {
  let files = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, item.name);
    if (item.isDirectory()) {
      if (item.name !== ".git" && item.name !== "node_modules") {
        files.push(...getFiles(fullPath));
      }
    } else if (item.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

const mdFiles = getFiles(".");
let hasErrors = false;
const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;

for (const file of mdFiles) {
  const content = fs.readFileSync(file, "utf8");
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    const url = match[2].trim();
    if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("mailto:") || url.startsWith("#")) continue;
    const cleanPath = url.split("#")[0].split("?")[0];
    if (!cleanPath) continue;
    const resolved = path.resolve(path.dirname(file), cleanPath);
    if (!fs.existsSync(resolved)) {
      console.error(`❌ Broken link in ${file}: "${url}" -> Target not found: ${resolved}`);
      hasErrors = true;
    }
  }
}
if (hasErrors) process.exit(1);
console.log("✅ All links valid!");
'
```

### 4. Pull Request Process
1. Fork and create a branch named `docs/<feature-or-fix>`.
2. Commit with descriptive, conventional commit messages:
   - `docs(data-model): clarify persistent storage TTL parameters`
   - `docs(api-reference): update SDK error code table`
3. Submit a Pull Request to `StellarCrove/lumenforge-docs:main`.
4. Ensure all CI checks pass.
