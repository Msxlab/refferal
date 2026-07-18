// Expo Metro configuration for the pnpm monorepo, following the official guidance:
// watch the workspace root and resolve packages from both node_modules locations.
const { getDefaultConfig } = require('expo/metro-config');
const exclusionList = require('metro-config/src/defaults/exclusionList');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const workspacePathPattern = (relativePath) => {
  const segments = path.join(workspaceRoot, relativePath).split(path.sep).map(escapeRegex);
  return new RegExp(`${segments.join('[/\\\\]')}[/\\\\].*`);
};

config.resolver.blockList = exclusionList([
  workspacePathPattern('.claude'),
]);

module.exports = config;
