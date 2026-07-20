/**
 * The app uses bundler-style extensionless TypeScript imports. Node's native
 * type stripper intentionally requires file extensions, so contract tests use
 * this tiny resolver instead of changing production imports just for tests.
 */
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.')) {
      try {
        return await nextResolve(`${specifier}.ts`, context);
      } catch {
        // Preserve Node's original resolution error for non-TypeScript paths.
      }
    }

    throw error;
  }
}
