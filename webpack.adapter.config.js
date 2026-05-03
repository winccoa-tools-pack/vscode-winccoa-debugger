/**
 * Webpack config for bundling the debug adapter CLI into a single file.
 *
 * The adapter is shipped as part of the extension VSIX in resources/debugAdapter.js
 * and deployed to the WinCC OA project's javascript/ directory at debug start time.
 *
 * External:
 *   - winccoa-manager is loaded at runtime from the WinCC OA installation path
 *     via dynamic import() / require() — never bundled.
 */
const path = require('path');

module.exports = {
  target: 'node',
  mode: 'production',
  entry: path.resolve(__dirname, 'node_modules', '@winccoa-tools-pack', 'winccoa-debug-adapter', 'dist', 'cjs', 'cli.js'),
  output: {
    path: path.resolve(__dirname, 'resources'),
    filename: 'debugAdapter.js',
    libraryTarget: 'commonjs2',
  },
  resolve: {
    extensions: ['.js'],
    conditionNames: ['require', 'node'],
    mainFields: ['main'],
  },
  // No ts-loader needed — input is already compiled CJS
  module: {
    rules: [],
  },
  // Suppress warnings for dynamic require/import (winccoa-manager loaded at runtime)
  ignoreWarnings: [
    { message: /Critical dependency: the request of a dependency is an expression/ },
  ],
  devtool: false,
};
