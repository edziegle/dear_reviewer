// Which files are test code, judged from the path alone by the usual
// conventions of each language. Kept apart from `vscode` so the unit tests
// can run it under plain Node.

const TEST_DIRECTORIES = new Set(["test", "tests", "__tests__"]);

const TEST_FILE_NAMES: readonly RegExp[] = [
  // Python
  /^test_.+\.py$/,
  /^.+_test\.py$/,
  /^conftest\.py$/,
  // TypeScript and JavaScript
  /^.+\.(test|spec)\.[^.]+$/,
  // Go
  /^.+_test\.go$/,
];

/** Whether the file, by its path from the repository root, is test code. */
export function isTestPath(path: string): boolean {
  const parts = path.split("/");
  const name = parts[parts.length - 1];
  return (
    parts.slice(0, -1).some((part) => TEST_DIRECTORIES.has(part)) ||
    TEST_FILE_NAMES.some((pattern) => pattern.test(name))
  );
}
