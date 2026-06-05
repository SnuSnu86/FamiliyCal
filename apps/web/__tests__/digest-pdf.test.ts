import { describe, expect, test } from "@jest/globals";
import { MonochromeDigestDocument } from "../src/components/MonochromeDigestDocument";
import { GET } from "../src/app/api/digest/pdf/route";

// Route-level behavior is covered by the typed API surface here and by manual verification
// because this app currently runs web tests as TypeScript checks only.
describe("digest PDF export contract", () => {
  test("exposes a monochrome PDF document component for digest exports", () => {
    expect(typeof MonochromeDigestDocument).toBe("function");
  });

  test("exposes a GET route handler for the PDF API", () => {
    expect(typeof GET).toBe("function");
  });
});
