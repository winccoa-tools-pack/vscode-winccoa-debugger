# WinCC OA VS Code Extension Template

<div align="center">

![Version](https://img.shields.io/github/v/release/winccoa-tools-pack/template-vscode-extension?label=version)
![License](https://img.shields.io/github/license/winccoa-tools-pack/template-vscode-extension)
![VS Code](https://img.shields.io/badge/VS%20Code-1.109.2-007ACC.svg)
[![Coverage](https://codecov.io/gh/winccoa-tools-pack/template-vscode-extension/graph/badge.svg)](https://codecov.io/gh/winccoa-tools-pack/template-vscode-extension)
[![Quality gate](https://github.com/winccoa-tools-pack/template-vscode-extension/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/winccoa-tools-pack/template-vscode-extension/actions/workflows/ci-cd.yml)
[![Released](https://github.com/winccoa-tools-pack/template-vscode-extension/actions/workflows/release.yml/badge.svg)](https://github.com/winccoa-tools-pack/template-vscode-extension/actions/workflows/release.yml)

</div>

Template repository for building **VS Code extensions for WinCC OA**, with a GitFlow-style branching model and a CI → prerelease → release pipeline.

## Quick start

Create a new repository from this template, then:

```bash
npm install
npm run compile
npm run test:unit
```

Run locally in VS Code:

To launch this extension, press **F5** in your VS Code instance to open an **Extension Development Host**.

## Customize the template

When you create a new repository from this template, update these placeholders first.

Update values in `package.json`:

- `name`, `displayName`, `description`
- `publisher` (VS Code Marketplace publisher ID) - **Note:** It's recommended to use the organization's publisher for easier trust and no need for individual VSCE tokens.
- `icon` (this repo includes a placeholder at `resources/icon.png` — replace it with your own 128x128 (or 256x256) PNG)
- `repository.url`, `bugs.url`, `homepage` (remove `<your-repository>` placeholders)
- `activationEvents` and `contributes.commands[].command`

Example:

```bash
npm pkg set name='vscode-my-extension'
npm pkg set displayName='WinCC OA — My Extension'
# Optional: Set your own publisher if not using the organization's
# npm pkg set publisher='my-publisher'  # Requires VSCE_PAT and user trust
```

Additionally, this template includes a dummy "Hello World" project. Search for and replace the following placeholders throughout the codebase:

- `'hello-world'` → your extension's identifier or name
- `'<your-repository>'` → your repository name

Also, update `src/const.ts` with the appropriate values for `EXTENSION_ID`, `EXTENSION_NAME`, and `EXTENSION_CONFIG_SECTION`.

### Template checklist

- Replace the placeholder icon in `resources/icon.png`.
- Replace all occurrences of `<your-repository>` with your actual repository name.
- Update the Marketplace identifiers (`publisher`, `name`) before publishing.
- Update links in `package.json` (`repository`, `bugs`, `homepage`) so they point to your new repo.

## Development scripts

These scripts exist in this template:

- Build: `npm run compile`
- Watch: `npm run watch`
- Lint: `npm run lint` and `npm run lint:md`
- Format check: `npm run format:check`
- Unit tests: `npm run test:unit`
- Integration tests (WinCC OA container): `npm run ci:integration`

## Branching model (GitFlow)

- `develop` is the default branch (day-to-day work)
- `main` is the stable branch (releases)
- `feature/*` / `bugfix/*` target `develop`
- `release/vX.Y.Z` and `hotfix/vX.Y.Z` target `main`

Automation overview:

- PR validation: `.github/workflows/gitflow-validation.yml`
- Upmerge `main` → `develop` via PR: `.github/workflows/gitflow.yml`
- Create release/hotfix branches + PR: `.github/workflows/create-release-branch.yml`
  - Important: this workflow does **not** update `CHANGELOG.md`.

More details:

- `docs/automation/GITFLOW_WORKFLOW.md`

## CI + Integration tests

- CI pipeline: `.github/workflows/ci-cd.yml`
- WinCC OA integration tests: `.github/workflows/integration-winccoa.yml`

More details:

- `docs/automation/CI-INTEGRATION.md`

## Pre-release + release pipeline

This template uses a **tested-artifact flow**:

1. A prerelease workflow builds/tests and uploads a VSIX to a GitHub **pre-release**.
2. The stable release workflow requires that prerelease artifact and republishes that tested VSIX.

Workflows:

- `.github/workflows/pre-release.yml` (alpha prerelease on PRs to `main`)
- `.github/workflows/release.yml` + `.github/workflows/release-reusable.yml` (stable release from `main`)

Marketplace publishing:

- Optional secret: `VSCE_PAT` (if set, the release workflow publishes to the VS Code Marketplace).

## First-time setup checklist

- Fill out the vision document: `docs/dev/VISION.md`.
- Update placeholders in `package.json` (name, publisher, repo URLs, command IDs).
- Decide on your default branch strategy (this template assumes `develop` is default).
- Configure secrets (as needed):
  - `VSCE_PAT` (optional) to publish to VS Code Marketplace during stable release.
  - `REPO_ADMIN_TOKEN` (recommended) to let `.github/workflows/apply-settings-and-rulesets.yml` apply `.github/repository.settings.yml` and `.github/rulesets/*`.
  - `DOCKER_USER` + `DOCKER_PASSWORD` (optional) only if your WinCC OA image is private on Docker Hub.
- Run Actions once to verify everything:
  - `CI/CD Pipeline`
  - `PR Labels` (open a PR to see labels apply)
  - `Git Flow Validation` (open a PR to see validation)
  - `Integration Tests - WinCC OA` (optional; requires a working image)

## Repo settings + rulesets automation

This template can apply repository settings + rulesets from YAML:

- Source of truth:
  - `.github/repository.settings.yml`
  - `.github/rulesets/*.yml`
- Workflow:
  - `.github/workflows/apply-settings-and-rulesets.yml`

To apply settings/rulesets, provide an admin-capable token:

- Secret: `REPO_ADMIN_TOKEN`
  - Classic PAT: scope `repo` (and authorize SSO if required)
  - Fine-grained PAT: repository access + **Administration: Read and write**

---

## 🛠️ Requirements

- **VS Code:** 1.107.1 or higher
- **WinCC OA:** 3.19+ installed on your system

---

## License

MIT License. See <https://github.com/winccoa-tools-pack/.github/blob/main/LICENSE>.

---

## ⚠️ Disclaimer

**WinCC OA** and **Siemens** are trademarks of Siemens AG. This project is not affiliated with, endorsed by, or sponsored by Siemens AG. This is a community-driven open source project created to enhance the development experience for WinCC OA developers.

---

## Quick Links

• [📦 VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mPokornyETM.wincc-oa-tools-pack)

---

<center>Made with ❤️ for and by the WinCC OA community</center>
