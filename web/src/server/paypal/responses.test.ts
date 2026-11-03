import { describe, expect, it } from "vitest";
import { tokenResponseSchema, verifyResponseSchema } from "./responses";

describe("PayPal response schemas (review finding 3)", () => {
  it("accepts a token response and requires access_token", () => {
    expect(tokenResponseSchema.parse({ access_token: "t", expires_in: 32400, token_type: "Bearer" })).toMatchObject({ access_token: "t", expires_in: 32400 });
    expect(tokenResponseSchema.safeParse({ expires_in: 1 }).success).toBe(false);
  });
  it("accepts a verify response and requires a verification_status string", () => {
    expect(verifyResponseSchema.parse({ verification_status: "SUCCESS" }).verification_status).toBe("SUCCESS");
    expect(verifyResponseSchema.safeParse({ verification_status: 1 }).success).toBe(false);
  });
});
