# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-05-05

### Added

- Add rebase-open-prs workflow (#4)
- replace BUSL-1.1 with proprietary license
- fetch debugAdapter.js from GH release instead of bundling via webpack
- add update:adapter:local script for local debugger development
- auto-rebuild npm-debugger and register sub-project fixture
- autoStartManager flag for attach, launch.json docs, tasks.json analysis
- sub-project debugging E2E test, Quick Debug, session-first flow
- add debug adapter lifecycle management (deploy, pmon, cleanup)
- add struct to all_types.ctl fixture and E2E variable test (test 6)
- add E2E variable display tests (all_types fixture + test suite)
- add register-project/unregister-project Makefile targets for manual testing
- add VS Code E2E debugger tests with DebugSessionHelper
- spawn debug adapter via bootstrap.js with TCP DAP transport
- add onStartupFinished activation + contribute commands
- wire ProjectDetector into extension + configurationProvider
- add ProjectDetector for Project Admin integration
- initial setup for vscode-winccoa-debugger extension

### Fixed

- update README license section and badge to proprietary (#20)
- update README license section and badge to proprietary
- override minimatch to 3.1.3 and serialize-javascript to 7.0.5 (security)
- replace gh CLI with Node.js fetch() in download-adapter.mjs (public repo, no auth needed)
- forward GITHUB_TOKEN to GH_TOKEN for gh CLI in GitHub Actions
- correct E2E test issues found during full test run
- replace placeholder helloWorld command test with real command check
- sort releases by date descending before find to always get newest
- find release with debugAdapter.js asset instead of blindly taking newest release
- markdown lint cleanup
- lint and format cleanup
- portable adapter path resolution and Windows junction support
- vscodeignore + Makefile cross-platform packaging (--no-dependencies, 109KB VSIX)
- cross-platform path handling (Windows + Linux support)
- test 4 — find runnable fixture project by name, not by index [0]
- add missing const.ts and otherExtensions.ts
- pathMappings template uses empty remote for scripts root
- correct pathMappings direction in configuration template
- kill adapter process on session terminate, prevent pmonIndex conflict

### Changed

- bump picomatch (#7)
- deps-dev(deps-dev): bump @types/node (#5)
- deps-dev(deps-dev): bump lodash from 4.17.23 to 4.18.1 (#8)
- deps-dev(deps-dev): bump the typescript group across 1 directory with 2 updates (#11)
- deps-dev(deps-dev): bump the dev-tools group across 1 directory with 5 updates (#12)
- bump actions/github-script from 8 to 9 (#13)
- deps-dev(deps-dev): bump @vscode/vsce from 3.7.1 to 3.9.1 (#14)
- bump uuid and @azure/identity (#15)
- deps-dev(deps-dev): bump globals from 17.4.0 to 17.6.0 (#18)
- prettier format fix on debugger-stop-on-entry-e2e
- rewrite README to match project-admin structure (badges, features, config reference)
- switch license from MIT to BSL-1.1 (2 user limit, Apache 2.0 after 2028-04-12)
- add BP verification assertions to lib BP E2E test
- update instructions.md — current test status + open findings
- CTRL class debugging E2E tests (Shape, Circle with inheritance)
- multi-lib BP E2E tests, fix library BP line constants
- register-project substitutes config placeholders, fix launch.json
- library BP e2e passes, skip flaky test 2
- fix e2e bpcycle test 1 — manager nums +1, once start mode, no manual start/stop
- add foundation E2E setup test (debugger-setup-e2e)
- add instructions.md with architecture, known issues and next steps
- wip: e2e test wiring — pmon-only factory, lifecycle start/stop, configDone wait
- wip: install debug adapter package, e2e test infrastructure, fixture scripts + launch.json
- wip: wire debug adapter cli path via symlink in test-local workflow
- add Makefile with test-local target and DevEnv workspace

## [0.2.1] - 2026-03-23

### Fixed

- add missing permissions to gitflow.yml and apply-settings callers

### Changed

- deps-dev(deps-dev): bump webpack-cli from 6.0.1 to 7.0.2 (#96)
- deps-dev(deps-dev): bump prettier from 2.8.8 to 3.8.1 (#79)
- deps-dev(deps-dev): bump the dev-tools group with 4 updates (#78)
- deps-dev(deps-dev): bump markdownlint-cli from 0.47.0 to 0.48.0 (#82)
- deps-dev(deps-dev): bump @types/vscode in the typescript group (#85)
- deps-dev(deps-dev): bump @types/node in the testing group (#77)
- deps-dev(deps-dev): bump globals from 17.3.0 to 17.4.0 (#80)

## [0.2.0] - 2026-03-18

### Changed

- Feature/setup repo workflow (#89)

## [0.1.5] - 2026-02-23

### Added

- merge all the changes from child repositories (#73)
- Update extension metadata and add core integration (#57)
- Enhance CI/CD workflows and Git Flow validation
- add workflows for creating release branches and pre-release process

### Fixed

- update workflow references to use the correct path for versioning-tags-changelog-reusable.yml
- update PR body text for organization sync workflow
- correct file path for integration tests in configuration
- increase line length limit for better readability

### Changed

- bump actions/github-script from 7 to 8 (#74)
- deps-dev(deps-dev): bump typescript-eslint from 8.53.1 to 8.54.0 (#60)
- deps-dev(deps-dev): bump the testing group with 2 updates (#58)
- deps-dev(deps-dev): bump typescript-eslint from 8.52.0 to 8.53.0 (#53)
- deps-dev(deps-dev): bump prettier in the dev-tools group (#52)
- deps-dev(deps-dev): bump @types/node from 22.19.5 to 25.0.9 (#54)
- bump actions/github-script from 7 to 8 (#55)
- bump actions/setup-node from 4 to 6 (#56)
- upmerge main to develop (#51)
- Upmerge (#49)
- corrected
- reeomove broken files
- load test
- no promt
- format
- remove unused imports and variables in example unit test
- fix example tests
- Update GitHub workflows for pre-release and release processes
- update CI/CD workflows and improve linting, formatting, and testing steps
- sync gh org files to repository (#43)
- update package.json and remove webpack configuration
- CRLF
- Provide all the pipelines, docs configs which we need in an good temp… (#40)
- npm install
- deps-dev(deps-dev): bump eslint from 8.57.1 to 9.39.2 (#32)
- deps-dev(deps-dev): bump @types/node from 24.10.1 to 25.0.3 (#34)
- deps-dev(deps-dev): bump @typescript-eslint/parser from 6.21.0 to 8.51.0 (#39)
- Add actions to sync org and template files (#37)

## [Unreleased]
