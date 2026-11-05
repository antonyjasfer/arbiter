// The agreement body stored on agreement_versions.body_json. Amounts are integer cents so the canonical
// JSON (and so the version hash) has exactly one form.
import { z } from "zod";

export const CRITERION_KINDS = ["test", "browser", "static", "review"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];

export const MAX_MILESTONES = 6;
export const MAX_CRITERIA = 8;
export const MIN_MILESTONE_CENTS = 5_000;

// Keys identify a milestone or criterion across versions (Phase 4 maps verdicts to them), so they are
// stable: an existing key never changes, and a new item gets the next free key (see checkBody).
export const MILESTONE_KEY = /^m\d{1,3}$/;
export const CRITERION_KEY = /^m\d{1,3}c\d{1,3}$/;

const milestoneFields = {
  title: z.string().trim().min(1).max(120),
  amountCents: z.number().int().min(0).max(500_000),
  dueInDays: z.number().int().min(1).max(90),
};
const criterionFields = { kind: z.enum(CRITERION_KINDS), text: z.string().trim().min(1).max(500) };
const questionsSchema = z.array(z.object({ key: z.string().regex(/^q\d{1,2}$/), question: z.string().min(1).max(300), why: z.string().max(300) })).max(5);

/** A stored body: every key present. */
export const agreementBodySchema = z.object({
  milestones: z.array(
    z.object({
      key: z.string().regex(MILESTONE_KEY),
      ...milestoneFields,
      criteria: z.array(z.object({ key: z.string().regex(CRITERION_KEY), ...criterionFields, needsHumanJudgment: z.boolean() })),
    }),
  ),
  questions: questionsSchema,
});

/** What a hand edit sends: new milestones and criteria come without keys; the server assigns them. */
export const agreementBodyInputSchema = z.object({
  milestones: z.array(
    z.object({
      key: z.string().regex(MILESTONE_KEY).optional(),
      ...milestoneFields,
      criteria: z.array(z.object({ key: z.string().regex(CRITERION_KEY).optional(), ...criterionFields, needsHumanJudgment: z.boolean().optional() })),
    }),
  ),
  questions: questionsSchema,
});

export type AgreementBody = z.infer<typeof agreementBodySchema>;
export type AgreementBodyInput = z.input<typeof agreementBodyInputSchema>;
