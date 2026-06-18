# Kian Social Media — content automation (DRAFTS ONLY, approval-gated)

> Safe by design: this workflow **generates and organizes** posts and **never publishes publicly
> without an explicit `Approved` flag**. All publishing nodes ship **disabled** until each platform's
> API + permissions are confirmed. Import file: `docs/n8n/kian-social-content-automation.json`.

---

## 1. What it does

**Draft path (active, manual):**
`Manual Trigger → Read Content Calendar (Google Sheet) → Select Rows Needing Drafts → Claude Draft
(Anthropic API) → Parse Claude JSON → Write Draft + status "Ready for Review" → Notify Owner`.

It only drafts rows that have a `topic`, **no** `caption` yet, and are **not** already `Approved`/`Published`
— so it never overwrites approved copy. It writes back `caption`, `hashtags`, `hook`, and sets
`status = Ready for Review`. It **does not** set `approval` — a human does that.

**Publish path (DISABLED, gated):**
`Publish Scheduler (disabled) → Read Calendar → Approval Gate → By Platform → Publish * (disabled
placeholders) → Mark Published (disabled)`.
The **Approval Gate** passes a row only when `approval = Approved`, `status ≠ Published`, **and**
`asset_link` is non-empty (no asset → never posts). Every platform publish node is a disabled `NoOp`
placeholder until you wire and approve the real API.

---

## 2. Content calendar (Google Sheet) — tab `Calendar`

One row per planned post. Header row (row 1) exactly:

| Column | Meaning |
|---|---|
| `date` | Planned date |
| `platform` | `LinkedIn` / `Instagram` / `TikTok` / `YouTube` / `X` |
| `topic` | What the post is about (required for drafting) |
| `service` | Kian service it promotes |
| `target_audience` | Who it's for |
| `hook` | Optional angle; AI may refine it |
| `caption` | **AI fills this** (leave empty to request a draft) |
| `hashtags` | **AI fills this** |
| `asset_link` | Google Drive / direct media URL (**required to publish**) |
| `status` | `Idea` → `Ready for Review` → (`Approved`) → `Published` |
| `approval` | **Human sets `Approved`** — the only thing that unlocks publishing |
| `publish_time` | When to publish (used once scheduling is enabled) |
| `notes` | Freeform brief notes for the AI |
| `row_number` | Used by n8n to update the right row (Google Sheets node provides it) |

> Airtable works too — swap the Google Sheets nodes for Airtable nodes; the column names map 1:1.

---

## 3. AI drafting (Anthropic / Claude)

- Endpoint `POST https://api.anthropic.com/v1/messages`, model **`claude-opus-4-8`**, `max_tokens: 2000`.
- A premium-Arabic system prompt instructs human-sounding, non-AI-looking, brand-aligned copy and asks
  for a strict JSON object (`hook`, `caption`, `hashtags`, `cta`); the **Parse Claude JSON** node extracts it.
- Headers: `x-api-key: {{ $env.ANTHROPIC_API_KEY }}`, `anthropic-version: 2023-06-01`, `content-type: application/json`.
- No `temperature`/`top_p` (removed on this model — would 400).

To tune voice, edit the `system` string in the **Claude Draft** node. To change model, swap the `model`
field (keep an exact id from Anthropic's model list).

---

## 4. Required env / credentials (all server-side; never in posts/logs)

| Where | Name | Purpose |
|---|---|---|
| n8n | `ANTHROPIC_API_KEY` | Claude caption generation. Server-side only. |
| n8n | `KIAN_CONTENT_SHEET_ID` | Google Sheet document id of the content calendar. |
| n8n | Google Sheets credential | Read/update the calendar (re-select on import). |
| n8n (later) | LinkedIn / Instagram (Graph) / TikTok / YouTube / X credentials | **Only** when you enable real publishing. |

n8n Cloud: if `{{ $env.* }}` is blocked, use `{{ $vars.* }}` (n8n Variables) or a credential instead.

---

## 5. Approval & safety rules (enforced)

1. Nothing publishes unless `approval = Approved`. (Approval Gate IF)
2. Nothing publishes without an `asset_link`. (Approval Gate IF)
3. The Publish Scheduler trigger and all 5 platform publish nodes + `Mark Published` are **disabled**
   on import — the workflow cannot post until you deliberately enable them.
4. The draft path never sets `approval` and never posts — it only proposes copy for human review.

---

## 6. Publish-readiness by platform (what's left to you)

| Platform | Status here | Needs before enabling |
|---|---|---|
| LinkedIn | Draft + placeholder | LinkedIn API app + `w_member_social`/org permissions, credential, map `asset_link`. |
| Instagram | Draft + placeholder | Instagram Graph API (Business/Creator account via Facebook app) + media container flow. |
| TikTok | Draft + placeholder | TikTok Content Posting API access (approval required) + credential. |
| YouTube Shorts | Draft + placeholder | YouTube Data API v3 OAuth + upload scope. |
| X / Twitter | Draft + placeholder | X API tier with write access (if/when available). |

For each: replace the `Publish <Platform> (DISABLED)` NoOp with the real node, enable it, enable the
`Publish Scheduler` trigger and `Mark Published`, then test on **one** approved row before scaling.

---

## 7. Test checklist (drafts)

1. Add 1–2 calendar rows with `topic`, `platform`, empty `caption`, `status = Idea`.
2. Open the workflow, select your Google Sheets credential, set `ANTHROPIC_API_KEY` + `KIAN_CONTENT_SHEET_ID`.
3. **Execute Workflow** → rows come back with Arabic `caption` + `hashtags`, `status = Ready for Review`.
4. Confirm approved copy is untouched (set one row `approval = Approved` with a caption, re-run → skipped).
5. Owner-notify placeholder fires (wire it to your channel).
6. Publishing stays inert (all publish nodes disabled).

## 8. Rollback

Delete or disable the workflow. It is standalone (separate from the WhatsApp workflow) and only
reads/writes the content calendar tab — removing it changes nothing else. No platform is touched while
the publish nodes remain disabled.
