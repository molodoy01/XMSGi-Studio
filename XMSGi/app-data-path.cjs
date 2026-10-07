function resolveAppDataPath(fileSystem, pathModule, userDataPath, currentFilename, legacyFilename) {
  const currentPath = pathModule.join(userDataPath, currentFilename);
  const legacyPath = pathModule.join(userDataPath, legacyFilename);

  if (
    currentPath === legacyPath
    || typeof fileSystem.existsSync !== 'function'
    || typeof fileSystem.renameSync !== 'function'
  ) {
    return currentPath;
  }

  try {
    if (fileSystem.existsSync(currentPath) || !fileSystem.existsSync(legacyPath)) {
      return currentPath;
    }

    fileSystem.renameSync(legacyPath, currentPath);
    return currentPath;
  } catch {
    return legacyPath;
  }
}

module.exports = { resolveAppDataPath };