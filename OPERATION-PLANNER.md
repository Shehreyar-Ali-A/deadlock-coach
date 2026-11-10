# Jev operation planner experiment

Branch `experiment/jev-operation-planner` starts at local `main` commit `56d46cf`. The experiment uses the existing Jev account, Ollama writer and versioned local cache.

## What changes for the player

| Request | Behavior on this branch |
| --- | --- |
| “Which fire-rate items cost up to 1,600 souls, and which should I buy?” | The planner can request both stat retrieval and purchase ranking. The stat scan returns every budget-matching row. The ranking step can select only from those rows. The answer includes the verified list. |
| “Can one item interrupt a channel and silence its caster on the same activation?” | Jev selects requirement phrases from the player's words and candidate item descriptions. A second pass selects source passages for each requirement on each candidate and checks whether the full request holds on a common trigger and target. |
| “Can I parry an ability and stun its caster?” after discussing Billy | A general effect search uses the latest question as its query. Each candidate has its own evidence. A related effect can appear as a partial match. Only candidates with joint support may flow into a subsequent purchase ranking. |
| “What does Rebuttal do?” | A standalone entity read can return the sourced Discord card directly. A reference-dependent comparison can retrieve the previous subject and use the writer. |
| “What items counter Billy's melee abilities?” | An identified opponent adds matchup evidence to the purchase operation. Hero effects, available funds, inventory and component ownership inform selection. |

## How decisions work

On main, Jev selects a single intent and TypeScript dispatches a corresponding branch. Main also has a hand-authored mechanic vocabulary and a special check for the parry/stun combination.

Here Jev chooses a primary operation and up to two additional operations from **entity**, **stat**, **effects**, **matchup**, **compare** and **rank**. It also resolves whether the request depends on the previous turn. Typed plan fields carry the opponent, shop stat and purchase ordering. The executor deduplicates operations, supplies their dependencies and runs retrieval before ranking. When stat and effect searches both constrain a purchase, the candidate pool is their intersection. The plan is bounded and inspectable; Jev cannot generate executable code or arbitrary database queries.

Effect search takes semantic nominations and a shortlist of items whose descriptions contain uncommon words from the selected requirements. Jev's citations must identify actual passages on the candidate. Merely finding a word on each of two different items cannot satisfy a compound request. The shop allowlist, prices, budget arithmetic, cache, per-user context, Discord commands and no-key local rules still use the existing implementation.

## Try it

With the existing local environment configured, run these from the repo in PowerShell:

```powershell
npm.cmd run build
npm.cmd test
node --env-file=.env dist/replay.js
```

The replay uses live Jev requests and local Ollama without posting to Discord. It includes single and successive matchup questions, a mixed lookup and purchase, two compound mechanics, and paraphrased stat searches. Enable `COACH_TRACE=1` for the operation list, opponent, retrieved IDs, Jev call count and fallback status. Use `npm.cmd run dev` for Discord testing. To return to the baseline, switch to `main` and rebuild if running compiled code.

## Limits

The stat lookup scans the full reviewed shop. Semantic effect search checks up to two nominated sources and six lexical candidates. “Could not verify” concerns that evidence; it does not prove the mechanic is impossible in game. Jev can misresolve an opponent, omit an operation or choose a suboptimal item. Its same-trigger judgment is semantic, not an in-game measurement. The live replay produced verified-note fallbacks on some tactical turns, so this is an experimental branch pending playtesting.
