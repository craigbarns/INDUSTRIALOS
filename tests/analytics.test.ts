import { describe, expect, it } from "vitest";
import { compareDecimal, recentMonths } from "@/lib/analytics";

describe("exact decimal comparison", () => {
  it("orders canonical decimal strings without floating-point conversion", () => {
    expect(compareDecimal("10", "9.99")).toBeGreaterThan(0);
    expect(compareDecimal("0.12", "0.120")).toBe(0);
    expect(compareDecimal("001.5", "1.50")).toBe(0);
    expect(compareDecimal("1150.00", "1200")).toBeLessThan(0);
    expect(compareDecimal("12345678901234567890.01", "12345678901234567890.02")).toBeLessThan(0);
  });
});

describe("recent month window", () => {
  it("returns twelve UTC month keys ending with the current month", () => {
    const months = recentMonths(new Date(Date.UTC(2026, 1, 15)));
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2025-03");
    expect(months.at(-1)).toBe("2026-02");
  });
});
