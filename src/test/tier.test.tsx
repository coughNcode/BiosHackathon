import { describe, expect, it } from "vitest";
import { simulate, tierFor } from "@/routes/lab";

describe("security tier", () => {
  it("10/10 is S-TIER", () => expect(tierFor(10).label).toBe("S-TIER"));
  it("8-9 is A-TIER", () => expect(tierFor(8).label).toBe("A-TIER"));
  it("6-7 is B-TIER", () => expect(tierFor(7).label).toBe("B-TIER"));
  it("below 6 needs work", () => expect(tierFor(5).label).toBe("NEEDS WORK"));
  it("ML evasion passes until retrained", () => {
    expect(simulate("ml_evasion_variant", false).result).toBe("PASSED");
    expect(simulate("ml_evasion_variant", true).result).toBe("BLOCKED");
  });
});
