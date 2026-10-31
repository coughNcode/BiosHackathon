import { describe, expect, it } from "vitest";
import { feedInterval } from "@/hooks/use-live";
describe("demo mode", () => {
  it("simulates a payment every 2 seconds in Demo Mode", () => expect(feedInterval(true)).toBe(2000));
  it("keeps the normal pace otherwise", () => expect(feedInterval(false)).toBe(4300));
});
