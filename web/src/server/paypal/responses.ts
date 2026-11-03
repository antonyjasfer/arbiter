// Shapes of the PayPal responses the client reads, validated at the boundary.
import { z } from "zod";

export const tokenResponseSchema = z.object({ access_token: z.string().min(1), expires_in: z.number().optional() });
export const verifyResponseSchema = z.object({ verification_status: z.string() });
