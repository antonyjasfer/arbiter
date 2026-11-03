// Flags briefs that contain text aimed at an AI rather than at a freelancer. A flag is shown to both
// parties; it does not block anything, because the deterministic checks and human approval decide.
export type BriefFlag = "ai_instructions";

const PATTERNS = [
  /\bignore\s+(?:all\s+|any\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts|rules)\b/i,
  /\byou\s+are\s+now\b/i,
  /<\s*\/?\s*(?:brief|answers|system|instructions?)\b/i,
  /\b(?:system\s+prompt|developer\s+message)\b/i,
  /\bmark\s+(?:everything|all(?:\s+criteria)?)\s+as\s+(?:passed|approved|complete)\b/i,
];

export function flagBrief(text: string): BriefFlag[] {
  return PATTERNS.some((p) => p.test(text)) ? ["ai_instructions"] : [];
}
