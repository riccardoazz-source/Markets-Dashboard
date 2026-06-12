# Event-date update protocol

This file is the single source of truth for **how dates get added or updated**
in the dashboard, so updates stay accurate and clutter-free ("no garbage").

It covers two different kinds of dates:

| Kind | Where | How it's updated |
|------|-------|------------------|
| **Official calendars** — FOMC meetings, Bitcoin halvings | `FOMC_MEETING_DATES`, `BTC_HALVING_DATES`, `HALVING_SCHEDULE` in `lib/config.ts` (+ `FOMC_TARGET_UPPER` in the macro route) | Copy the official schedule verbatim. Pure facts, no judgment. |
| **Curated events** — wars, crises, IPOs, crypto, etc. | `MARKET_EVENTS` in `lib/config.ts` | Must clear the **inclusion bar** and carry a verified `source`. |

## The two hard rules (curated events)

1. **VERIFY.** Every date is confirmed against a reputable source **at the time
   it's added**, and stored with a `source` URL. If a concrete date can't be
   verified, it is **not added** — the answer is "can't verify", never a guess.
   - Example: *"Add the Anthropic IPO"* → Anthropic is private, there is no
     listing date → **not added**, reported as such.

2. **QUALIFY.** The event must clear its category bar (defined in the comment
   block above `MARKET_EVENTS` in `lib/config.ts`). The bar is **strict /
   landmark only** — curated history is a highlight reel, not a log. When in
   doubt, leave it out.

## The workflow when you ask for an update

1. **Classify** each requested item: official calendar vs curated event.
2. **Verify** each date via web search; capture a source link.
3. **Apply the bar** to curated events.
4. **Preview** — present a table before changing anything:

   | ✓/✗ | Date | Event | Category | Source | Why it qualifies (or why not) |

   Rejected items are listed with the reason (e.g. "still private", "below the
   $2B / landmark bar", "couldn't verify the date").
5. **Approve** — you confirm. Only approved rows are committed.
6. **Commit** — de-duplicated by `date + label` so re-running an update never
   double-adds.

## Scope discipline

I add **exactly** what you ask for — no "rounding out" with adjacent dates
unless you explicitly say "and add anything else important". This keeps every
addition intentional and traceable.

## Adding to the "Personal" category

`personal` has **no bar** — it's yours. Add freely from the **Sources tab →
Market Events → Personal**, or ask me to add a date there and I'll place it
without applying the significance filter.
