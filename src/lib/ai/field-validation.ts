export const decimalKeys = new Set(["unitPrice", "toolingCosts", "minimumOrderQuantity", "minimumQuantity", "maximumQuantity", "totalAmount"]);

/** Canonical financial values are strings; no floating-point conversion occurs. */
export function isDecimalString(value: string) {
  return /^\d+(\.\d+)?$/.test(value);
}
