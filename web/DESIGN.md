# Arbiter design tokens

Arbiter shows money and evidence, so the interface stays plain and readable: neutral surfaces, one accent, and a fixed set of status colours. Tokens live as CSS variables in `src/app/globals.css` (light in `:root`, dark in `.dark`) and are exposed to Tailwind through `@theme inline`. The base is shadcn `base-nova` with the neutral palette.

| Token | Use |
|---|---|
| `--primary` (teal, `oklch(0.47 0.09 195)` light / `oklch(0.72 0.1 195)` dark) | The one accent: primary buttons, the active role, focus ring (`--ring`). Nothing else is teal. |
| `--background`, `--foreground`, `--muted-foreground`, `--border` | Neutral surfaces and text (shadcn neutral). |
| `--status-pass` (green) | A criterion passed; a payment completed. |
| `--status-fail` (red) | A criterion failed; a payment failed. Also `--destructive` for destructive actions. |
| `--status-review` (amber) | Needs human review; capture pending. |
| `--status-pending` (slate) | Queued or running; waiting on PayPal or the runner. |

Use as Tailwind classes, for example `text-status-pass`, `bg-status-review/15`.

**Type:** Geist Sans for text, Geist Mono for ids, hashes, amounts in tables and commit SHAs. Sizes from Tailwind's default scale; page titles `text-2xl font-semibold`, landing headline `text-4xl`.

**Spacing and radius:** Tailwind's 4 px scale; sections `gap-6`, cards `gap-4`. Radius `--radius: 0.625rem` with shadcn's derived sizes.

**Rules:** no gradients, glass effects or decorative animation. Status is never shown by colour alone: always pair it with a word (PASS, FAIL, NEEDS REVIEW). Amounts always show the currency.
