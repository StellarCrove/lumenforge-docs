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

Before opening a pull request, verify that no relative links or target anchors are broken across the repository.

You can run the repository's dedicated validation script:

```bash
node scripts/validate-links.cjs
```

#### What the validator checks:
- **Relative file paths**: Ensures all linked Markdown files (`.md`) and assets exist on disk relative to the referencing document.
- **Anchor jumps**: Verifies that `#section-anchor` targets match slugified Markdown headings (`#`, `##`, `###`).
- **Cross-document anchor targets**: Checks that links targeting anchors in other files (e.g. `docs/foo.md#bar`) actually correspond to headings in that file.

#### Troubleshooting common validator failures:
- `❌ Broken link ... Target not found`: Check if the relative directory path needs `../` or `docs/`.
- `⚠️ Warning ... In-page anchor not found`: Headings containing special characters or question marks produce slugified anchors without punctuation (e.g. `## What is X?` becomes `#what-is-x`).
- Keep external links using `http://`, `https://`, or `mailto:` which are skipped by the local filesystem check.

### 4. Pull Request Process
1. Fork and create a branch named `docs/<feature-or-fix>`.
2. Commit with descriptive, conventional commit messages:
   - `docs(data-model): clarify persistent storage TTL parameters`
   - `docs(api-reference): update SDK error code table`
3. Submit a Pull Request to `StellarCrove/lumenforge-docs:main`.
4. Ensure all CI checks pass.
