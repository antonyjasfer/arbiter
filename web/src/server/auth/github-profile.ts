import { z } from "zod";

// The GitHub profile Auth.js hands to the jwt callback, validated at the boundary.
export const githubProfileSchema = z.object({
  id: z.union([z.number().int(), z.string().min(1)]),
  login: z.string().min(1),
  name: z.string().nullish(),
  email: z.string().nullish(),
  avatar_url: z.string().nullish(),
});
