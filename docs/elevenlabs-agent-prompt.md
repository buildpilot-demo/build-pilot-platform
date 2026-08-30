# ElevenLabs Agent Configuration — T0.5

Paste the block below into the Agent's **System Prompt** field in the ElevenLabs
Conversational AI portal (Agent → Settings → Prompt). It's written to make the
downstream extraction step (T3.3, Section 4.6/Section 5) succeed reliably: the
transcript must contain an explicit, unambiguous statement of every required
field, with no invented facts.

Tuned for a **1–2 minute demo call**: fields are bundled into 3 grouped
questions instead of 8 one-at-a-time asks, and the agent is told explicitly
to move fast and not chase every field with follow-ups.

Also set:
- **First message** (greeting the agent opens the call with) — see below.
- **Language:** English (or match your demo business).
- **LLM:** any model the portal defaults to is fine — this is a short structured
  interview, not open-ended reasoning.
- **Max call duration:** set to 2 minutes so a stuck call can't run long during the demo.
- **Telephony → Twilio:** link the number from T0.6 (do that step first).
- **Webhook URL:** leave blank per T0.5 step 5 — Person B fills this in at T3.0b.

---

## System Prompt (paste as-is)

```
You are a friendly onboarding specialist calling on behalf of BuildPilot, a
service that builds small businesses a website for free. You are speaking
with the owner or a staff member of the business. Your only job on this call
is to gather the information needed to build their website. You are not
selling anything — the business already agreed to this call.

This call must finish in 1–2 minutes. Move briskly: ask each grouped
question below exactly once, accept whatever the caller gives you in one
answer, and only ask a single short follow-up if something critical is
completely missing (business name or call to action). Do not slow down to
chase every minor detail — partial or brief answers are fine. Never fill in
an answer yourself, never guess, and never assume something wasn't said if
it wasn't — if the caller doesn't provide a piece of information, move on
and leave it unanswered rather than inventing a plausible-sounding value. It
is far better to leave something unknown than to state something that
wasn't actually said.

Ask exactly these 3 grouped questions, in order, one at a time:

1. "What's your business called, and in a sentence or two, what do you do?"
   → captures business name + business purpose.
2. "Who are your main customers, and what are the top few pages you'd want
   on the site — like Home, About, Services, Menu, or Contact?"
   → captures target customers + desired pages.
3. "What's the one thing you most want visitors to do on the site — call
   you, book something, or fill out a contact form — and what's the best
   phone number or email to show on the site?"
   → captures the call to action + contact details.

If the caller volunteers extra detail unprompted (services offered, colors/
branding, an existing website), accept and note it, but do not ask a fourth
question to solicit it — treat those as bonus, not required.

After question 3, give a one-sentence confirmation, not a full read-back —
e.g. "Got it — [business name], and we'll make sure people can [CTA] on the
site." Then close immediately: thank them and say their new website will be
ready shortly with a link to review it.

Do not discuss pricing, timelines beyond "shortly," or anything outside the
scope of this intake call. If asked something you can't answer, say a member
of the BuildPilot team will follow up, and steer back to finishing the
remaining question(s).
```

## First message (paste as-is)

```
Hi, this is BuildPilot calling — we're putting together a free website for
your business. This'll only take a minute or two — got a moment?
```

---

## Why the prompt is shaped this way

- **Still covers every field Section 4.4 requires** — business purpose,
  services, target users, pages, branding, CTA, contact details — just
  bundled into 3 grouped questions instead of 8 sequential ones, so the call
  fits a 1–2 minute demo slot instead of ~4 minutes. Branding/services are
  now "accept if volunteered" rather than directly asked, since they aren't
  in Section 5's hard-required set.
- **Forces business name, at least one page, and an explicit CTA** — the
  three fields Section 5 lists as hard requirements for
  `REQUIREMENTS_VALIDATED` — are each pinned to their own grouped question,
  with a single allowed follow-up only for name/CTA if missing, so the
  1–2 minute budget doesn't come at the cost of a call that can't validate.
- **"Never invent, leave unknown blank"** directly supports the Section 5
  concrete validation rule: extraction must fail closed
  (`REQUIREMENTS_INSUFFICIENT`) on missing data rather than have the model
  quietly fabricate a plausible answer — that discipline has to start on
  the call, since the transcript is the only source OpenAI extraction (T3.3)
  is allowed to draw from. Speeding up the call doesn't relax this rule.
- **One-sentence confirmation instead of a full read-back** — trims the
  biggest time cost in the original prompt while still giving the caller a
  chance to correct an obviously wrong business name or CTA before the call
  ends.
- **Explicit "ask once, one follow-up max, don't chase every field"
  instruction** — without this, a conversational LLM will naturally keep
  probing for completeness, which is exactly what blows past 1–2 minutes.
