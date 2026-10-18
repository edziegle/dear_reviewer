import * as assert from "assert";
import { isTestPath } from "../../src/testFiles";

describe("Test files", () => {
  it("knows Python's conventions", () => {
    for (const path of [
      "test_legality.py",
      "pkg/test_pay.py",
      "pkg/pay_test.py",
      "conftest.py",
      "pkg/conftest.py",
    ]) {
      assert.strictEqual(isTestPath(path), true, path);
    }
  });

  it("knows TypeScript's and JavaScript's conventions", () => {
    for (const path of [
      "src/pay.test.ts",
      "src/pay.spec.ts",
      "src/pay.test.jsx",
      "src/__tests__/pay.ts",
    ]) {
      assert.strictEqual(isTestPath(path), true, path);
    }
  });

  it("knows Go's convention", () => {
    assert.strictEqual(isTestPath("pay/pay_test.go"), true);
  });

  it("counts everything under a test or tests directory", () => {
    for (const path of [
      "test/helpers.rb",
      "tests/fixtures/data.py",
      "extension/test/suite/review.ts",
      "src/pay/tests/util.go",
    ]) {
      assert.strictEqual(isTestPath(path), true, path);
    }
  });

  it("leaves production files alone, even when their names contain test", () => {
    for (const path of [
      "attestation.py",
      "src/contest.ts",
      "latest/pay.py",
      "src/latest.py",
      "testing.py",
      "src/pay.ts",
      "src/test.ts",
      "src/protest/pay.go",
      "pay_testing.go",
    ]) {
      assert.strictEqual(isTestPath(path), false, path);
    }
  });
});
