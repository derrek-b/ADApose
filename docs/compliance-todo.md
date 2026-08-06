# Compliance TODO — action items, not deferred features

Distinct from `v2-ideas.md`: that file tracks *optional* product ideas
deliberately parked ("not commitments"). This file tracks compliance-required
work items — things we've represented as true (to a bank, a regulator) that
need an actual mechanism behind them, not just intent. An entry here is a
commitment, even if not yet built.

## Geo-restriction for sanctioned/high-risk jurisdictions

**What:** block or restrict app access from the jurisdictions listed below.

**Why:** our bank's AML/CFT compliance questionnaire (2026-08-03) asked
whether we or our customers engage in crypto activity involving sanctioned
or high-risk jurisdictions. We answered "No" — but the app today (`web/`)
has no geo-restriction of any kind; it's a public, permissionless web app
reachable from anywhere. "No" is only durably true once there's an actual
blocking mechanism, not just an assumption based on having no users yet.

**Status:** not implemented. No middleware, no IP/geo check exists anywhere
in `web/` as of this writing.

**Country list, exactly as given on the bank's questionnaire (2026-08-03):**
Afghanistan, Belarus, Burundi, Cuba, Democratic Republic of the Congo, Iran,
Iraq, Ivory Coast, Liberia, Libya, Myanmar, North Korea, Palestine, Russia,
South Sudan, Sudan, Somalia, Syria, Ukraine, Yemen, Zimbabwe.

**Known nuance to resolve at implementation time, not now:** several entries
on the bank's list (notably Ukraine and Palestine) are, under the actual
current OFAC sanctions programs, region-specific (e.g. Crimea and the
so-called DNR/LNR territories within Ukraine), not whole-country. The bank's
list treats them as full countries. Implementer should check the live OFAC
country/region list at build time rather than blanket-blocking an entire
country where the real program is narrower — but until built, block at the
country granularity listed above, matching what we represented to the bank.

**Likely implementation:** a geo-IP check in Next.js middleware (`web/`),
using whatever geolocation signal the eventual hosting provider exposes
(e.g. Vercel's `request.geo`/`geolocation()` headers) or a third-party geo-IP
lookup if self-hosting. Blocks/redirects at the edge before any page or API
route runs. Not designed in detail here — this entry exists so the
requirement and the exact country list survive until someone picks it up.

**Revisit trigger:** before onboarding any real (non-test) users — this
should ship before that point, not after.

## Wallet-address OFAC/SDN screening — distinct from geo-restriction, not the same control

**What:** check the connecting wallet address (and ideally destination/
counterparty addresses) against OFAC's published SDN list before allowing
an interaction, at the app/interface level.

**Why this is a separate item, not covered by geo-restriction above:**
geo-restriction blocks by IP-inferred country; it says nothing about *who*
is connecting. OFAC's SDN list includes specific known-sanctioned crypto
addresses (e.g. Tornado Cash-related addresses) — a sanctioned individual
physically located in a non-sanctioned country, or anyone geo-restriction
missed via VPN, is exactly the gap this control closes. The two are
complementary, not redundant, and only address-level screening is what
actually lets us truthfully check "Sanction Screening (OFAC and other
lists)" as a formally-included AML/CFT program element on any bank
questionnaire — geo-restriction alone does not support checking that box.

**Status:** not implemented. No address-screening exists anywhere in
`web/` as of this writing.

**Likely implementation:** check the connecting wallet address against the
OFAC SDN list at connect-time — either the list OFAC publishes directly, or
a low-cost third-party API (Chainalysis, TRM Labs, and similar offer this)
if a maintained/updated feed is preferred over self-hosting the raw list.
Standard practice at the interface level for several major DeFi front-ends
(Uniswap, dYdX, etc.) — the underlying contracts stay permissionless, the
company-operated front-end is what screens. Not designed in detail here.

**Revisit trigger:** same as geo-restriction above — before onboarding any
real (non-test) users, and specifically before checking "Sanction
Screening" as an included AML/CFT program element on any future compliance
form.

## Smart-contract security audit — supports the custody claim, is not "Independent Audit/Testing"

**What:** an independent third-party security audit of the vault/automation
smart contracts, confirming no key other than the owning user's (or a
correctly-scoped, principal-safe executor redeemer — see the custody entry
below) can move funds out.

**Why it's tracked separately from the AML/CFT program checklist:** a
contract security audit is real, valuable work, and strong supporting
evidence for the non-custodial claim discussed in the custody entry below —
but it answers a different question than "Independent Audit/Testing" on an
AML/CFT program questionnaire. That element means independent review of
the *AML compliance program itself* (is KYC/screening/monitoring/SAR
process being followed and adequate) — one of the standard BSA/AML program
pillars. A code audit doesn't touch that. Don't check that box on the
strength of a contract audit; do the audit anyway, and cite it directly
(to the bank, in narrative answers, to users) as evidence for the custody
classification instead.

**Status:** not yet done — no vault/automation contracts exist yet to
audit (nothing to validate before the vault/automation layer is actually
built, per D27/D28 Phase 2).

**Revisit trigger:** before the individual-vault/automation layer (D27,
Phase 2) ships to real users — an audit confirming the owner-gated/
executor-scoped design actually holds should land before that, not after.

## Custody classification of vault/automation layer — confirm before v2 ships

**Status:** deferred, on purpose — not actionable yet. Nothing to build or
decide until the vault/automation layer is actually being designed. Follow
up specifically once (a) the company has formally incorporated the
automated-vault mechanics as a real product effort (not just design docs)
and (b) a lawyer is under retainer to give an actual opinion — this isn't
a determination to make unilaterally off industry analogy alone, however
well-grounded the Beefy comparison is.

**What:** whether user assets held in an on-chain validator ("vault") smart
contract, and separately, assets passing through a company-controlled wallet
in the auto-compounding farm layer, constitute "custody" for AML/MSB/banking
purposes.

**The actual test (corrected 2026-08-03 — an earlier version of this entry
was too broad):** industry practice (Beefy, Yearn, Autofarm and similar
auto-compounding vault protocols) treats scoped, code-constrained automation
as non-custodial. A keeper/executor key that calls specific functions
(harvest, compound, rebalance) with no per-transaction user signature is
fine, *provided the contract code makes it structurally impossible for that
key to redirect a user's locked principal anywhere except back to that same
user or within the vault's own accounting*. The test is whether the
company-held key's on-chain authority is scoped to value-preserving
operations, not whether a human/bot acts without a fresh signature per se —
that's what "assets locked in a smart contract, not held by a company"
actually means in practice.

- **v1 aggregator/zap-in (current, live design):** non-custodial, no gray
  area — no vault exists at all, LP tokens go straight to the user's own
  wallet (D28 addendum, 2026-08-02).
- **Individual per-user vaults (D27, planned for managed strategies):** the
  Beefy-style case, and the right target to build toward — not something to
  second-guess in principle. Architect the redeemer set so the executor can
  only trigger scoped automation (compound/rebalance) that can never move
  principal to any address but the vault or the owner, with a separate
  owner-only redeemer for actual withdrawal. If built that way, calling it
  non-custodial matches how the rest of the industry treats the same
  pattern. Not yet built, so not yet verified against this description —
  that's the thing to confirm once the redeemer design exists, not a reason
  for doubt now.
- **Auto-compounding farm layer** (legacy design, `legacy/`, dormant, kept
  only as a possible future add-on per `CLAUDE.md`): different in kind, not
  degree, from the vault case above — a company-controlled wallet (a real
  private key) is not a smart contract holding assets, however briefly it
  holds something. Whether this specific mechanic is non-custodial depends
  on exactly what it does: a strictly atomic, no-discretion pass-through
  (receive, immediately forward, no state where the company could choose
  otherwise) is a much closer case than anything that holds or aggregates
  before forwarding. Needs its own precise answer when this layer is
  revisited — not assumed clean by analogy to the vault, and not assumed
  unclean either.

**Bottom line:** don't under-build the vault's owner-gated design out of
excess caution — Beefy-style scoped automation is legitimately non-custodial
and is the target. The farm-layer company-wallet mechanic is the one piece
that doesn't get this analogy for free and needs its own specific answer.

**Revisit trigger:** company incorporates work on the automated-vault
mechanics AND has a lawyer under retainer — both conditions, not either
alone. Confirm the actual redeemer/wallet mechanics match the description
above, with actual counsel sign-off, before representing custody status to
a bank or regulator for anything beyond the v1 aggregator.
