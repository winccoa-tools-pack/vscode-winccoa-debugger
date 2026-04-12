.PHONY: help install build build-deps clean watch package test test-local register-project unregister-project

# Variables
EXTENSION_NAME := vscode-winccoa-debugger
VERSION := $(shell node -p "require('./package.json').version")
BIN_DIR := bin
EXT_PUBLISHER := winccoa-tools-pack
EXT_NAME := vscode-winccoa-debugger
EXT_ID := $(EXT_PUBLISHER).$(EXT_NAME)
NPM := npm
VSCE := npx vsce

# npm-linked dependency that must be rebuilt before webpack bundles it
NPM_DEBUGGER_DIR := $(shell node -e "try{console.log(require('fs').realpathSync('node_modules/@winccoa-tools-pack/winccoa-debug-adapter'))}catch(e){console.log('')}")

# Test workspace configuration
TEST_WORKSPACE ?= DevEnv.code-workspace
CODE_BIN ?= code
FORCE_CLOSE_VSCODE ?= no
SKIP_UNINSTALL ?= yes
CLOSE_OLD_WINDOW ?= no

# Local build counter file
LOCAL_COUNTER_FILE := $(BIN_DIR)/.local_build_counter

# OS Detection
ifeq ($(OS),Windows_NT)
    DETECTED_OS := Windows
    RM := del /Q /F
    RMDIR := rmdir /S /Q
    MKDIR := mkdir
    KILL_CODE := taskkill /IM Code.exe /F 2>nul || echo "No VS Code process found"
    DEVNULL := nul
    TRUE := echo.
else
    DETECTED_OS := $(shell uname -s)
    RM := rm -f
    RMDIR := rm -rf
    MKDIR := mkdir -p
    KILL_CODE := pkill -f "$(CODE_BIN)" 2>/dev/null || echo "No VS Code process found"
    DEVNULL := /dev/null
    TRUE := true
endif

# Default target
help:
	@echo "Available targets:"
	@echo "  make install          - Install all dependencies"
	@echo "  make build            - Build extension"
	@echo "  make clean            - Remove build artifacts"
	@echo "  make watch            - Watch mode for development"
	@echo "  make package          - Package extension as .vsix"
	@echo "  make test             - Run tests"
	@echo "  make test-local       - Build, package with local stamp, install in VS Code, open workspace"
	@echo "  make register-project - Register fixture project in pvssInst.conf (for manual VS Code testing)"
	@echo "  make unregister-project - Remove fixture project from pvssInst.conf"
	@echo ""
	@echo "Local Test Configuration:"
	@echo "  TEST_WORKSPACE        - Path to test workspace (default: DevEnv.code-workspace)"
	@echo "  CODE_BIN              - VS Code binary (default: code)"
	@echo "  FORCE_CLOSE_VSCODE    - Close all VS Code instances before opening (default: no)"
	@echo "  SKIP_UNINSTALL        - Skip uninstall step (default: yes)"
	@echo "  Example: make test-local CODE_BIN=code-insiders"

# Install dependencies
install:
	@echo "Installing dependencies..."
	npm install
	@echo "Dependencies installed successfully!"

# Build everything
build: build-deps
	@echo "Building extension..."
	npm run compile
	@echo "Build completed successfully!"

# Rebuild npm-linked dependencies (npm-winccoa-debugger) so webpack picks up changes
build-deps:
ifneq ($(NPM_DEBUGGER_DIR),)
	@echo "Rebuilding npm-winccoa-debugger ($(NPM_DEBUGGER_DIR))..."
	@cd "$(NPM_DEBUGGER_DIR)" && npm run build
	@echo "npm-winccoa-debugger rebuilt."
else
	@echo "npm-winccoa-debugger not npm-linked, skipping rebuild."
endif

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist/ out/ bin/ node_modules/
	@echo "Clean completed!"

# Watch mode for development
watch:
	@echo "Starting watch mode..."
	npm run watch

# Package extension
package: build
	@echo "Packaging production release..."
	@-$(MKDIR) $(BIN_DIR) 2>$(DEVNULL) || $(TRUE)
	$(VSCE) package --no-dependencies -o $(BIN_DIR)/$(EXTENSION_NAME)-$(VERSION).vsix
	@echo "Extension packaged to $(BIN_DIR)/$(EXTENSION_NAME)-$(VERSION).vsix"

# Run tests
test:
	@echo "Running tests..."
	npm test

# Local test target - Build, package with local stamp, install in VS Code, open workspace
test-local: build
	@node scripts/test-local.js $(BIN_DIR) $(EXTENSION_NAME) $(VERSION) $(EXT_ID) $(CODE_BIN) $(TEST_WORKSPACE)

# Register the "runnable" fixture project in pvssInst.conf so it appears in
# the VS Code Project Admin extension and can be launched manually with F5.
# Run 'npm run compile' first if out/test/fixtures/ is missing.
register-project: build
	@echo "Registering WinCC OA fixture project 'runnable'…"
	@node scripts/register-project.js

# Remove the "runnable" fixture project from pvssInst.conf.
unregister-project:
	@echo "Unregistering WinCC OA fixture project 'runnable'…"
	@node scripts/unregister-project.js
