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

  it("knows the conventions of Java, Kotlin, Rust, Terraform and other languages", () => {
    for (const path of [
      "src/main/java/PayTest.java",
      "src/PayTests.kt",
      "src/TestPay.java",
      "Pay.Tests/PayTests.cs",
      "spec/pay_spec.rb",
      "lib/pay_test.rb",
      "src/pay_test.cc",
      "modules/vpc/vpc.tftest.hcl",
      "modules/vpc/main.tftest.json",
      "src/test/java/com/acme/Pay.java",
      "crates/pay/tests/integration.rs",
    ]) {
      assert.strictEqual(isTestPath(path), true, path);
    }
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
      "src/Contest.java",
      "src/Attest.kt",
      "src/Testimony.java",
      "src/Protest.cs",
      "modules/vpc/main.tf",
    ]) {
      assert.strictEqual(isTestPath(path), false, path);
    }
  });
});
