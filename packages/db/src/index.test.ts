import { expect, test } from "vitest";
import { PACKAGE_NAME } from "./index.js";

test("package identifies itself", () => {
  expect(PACKAGE_NAME).toBe("@pulse/db");
});
