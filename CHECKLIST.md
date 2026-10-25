# TrustVault checklist

Everything the problem statement, the instructions page and the challenge mail ask for, and where it stands.
✅ done and verified · 🟡 partly done / known gap · ❌ not done

_Last updated: 25 Oct 2026, 2:15 PM IST. Deadline: 6:00 PM IST._

## 1. The ten requirements

| # | Requirement | Status | Where / how it was checked |
|---|---|---|---|
| 1 | Authentication with admin, owner, viewer roles; written down what each can do | ✅ | README "What each role can do"; `session.js`; T-10, T-11 |
| 2 | Upload, organise, search and manage documents | ✅ | Upload with name/category/description, rename, new versions, trash + restore |
| 3 | Per-document permissions, at least read and edit, to named people | ✅ | `grants` table, sharing panel; T-05, T-06 |
| 4 | Owners can grant access and take it back | ✅ | `PUT/DELETE /documents/:id/grants/:userId`; T-07 |
| 5 | Not granted → cannot read, download, change or delete | ✅ | `authorizeDocument()` on every route; T-01 to T-14; checked live as Victor |
| 6 | Audit trail of uploads, downloads, changes, deletions, permission changes | ✅ | `audit.js`; T-20 to T-24; checked live as admin |
| 7 | Search by name, owner, category and date | ✅ | Filter bar; T-04 |
| 8 | Validation of what is uploaded | ✅ | Allow-list + file bytes + 5 MB + safe filename; T-30 to T-32 |
| 9 | Admin view of document activity and permission changes | ✅ | Admin → Overview, Audit trail, Users |
| 10 | Automated tests that one user cannot reach another's documents | ✅ | 34 tests; `npm run mutation-check` catches all 16 removed checks |

## 2. The three standards ("not negotiable")

| Standard | Status | Evidence |
|---|---|---|
| Reachable only by someone granted it, through any route, decided by the server every time | ✅ | One decision point (`authz.js`), 404 for outsiders, search filtered; live attack checks passed |
| You can prove who reached it, including refused attempts; the trail can't be quietly altered | ✅ / 🟡 | Refusals logged; DB trigger blocks edits; HMAC chain detects rewrites. Gap: cutting off the newest rows is not detected (THREATS E6) |
| Taking access away works immediately; anything issued before stops working | ✅ | No cache, no tokens, no signed links; T-07, T-08, T-08b |

## 3. What to hand in

| Deliverable | Status | Notes |
|---|---|---|
| Git repository with history (not one commit) | 🟡 | 10 commits, all on 25 Oct (explained in PROMPTS.md). **Private until 6 PM, then make it public** |
| Live URL with seed data, one login per role in README | ✅ | https://trustvault-76hy.onrender.com |
| `THREATS.md`: threats, what was done, what was accepted and why | ✅ | 40+ entries in 7 groups, each with status and test |
| `PROMPTS.md`: ≥ 5 dated entries, ≥ 2 on authorisation/access/audit, with commit links | ✅ | 6 entries, 4 on auth/access/audit, all linked |
| `PROMPTS.md`: reused prompts / context files | ✅ | "Reused context / instructions" section |
| Automated tests, including cross-user access | ✅ | `npm test` (34) |
| Database schema and setup scripts | ✅ | `server/src/schema.sql`, `npm run db:setup --prefix server` |
| Deployment instructions that work from a clean clone | ✅ | Verified: fresh clone → `npm run build` → `npm test` passes |
| API documentation with who may call each endpoint | ✅ | `API.md` |
| Five-minute demo video | ❌ | **You record it.** Show only what works |
| Short write-up (built, not built, permission model in your words, AI, unfinished) | 🟡 | `WRITEUP.md` drafted. **Rewrite the permission-model paragraph in your own words** |
| Submission form: title, one-line description, 2 links, 6 answers, tick "I am done" | ❌ | Do by ~5 PM |

## 4. Design decisions they will ask about ("where you have freedom")

| Decision | Our answer | Status |
|---|---|---|
| Permission model | Per-document grants (read / edit) to named people; owner-only sharing; roles never give document access | ✅ |
| How files are stored and made unreachable | Bytes in the database; only exit is the download route after the check | ✅ |
| What "taking access away immediately" means and costs | Next request is refused; costs one DB lookup per request and no file caching | ✅ |
| How the audit trail is protected | Trigger + HMAC chain + key outside the DB | ✅ |
| External sharing | Not built (breaks "prove who reached it") | ❌ by choice |
| Versions | Built: every new upload is a version, old ones downloadable | ✅ |
| Deletion and recovery | Soft delete to owner's trash, restore | ✅ |
| Retention / permanent purge | Not built | ❌ |
| What the admin sees, what is worth noticing | Refused attempts (24h + top 7 days), downloads, recent permission changes, chain check, CSV export | ✅ |
| AI inside the product (optional): suggests, never widens access alone, both audited | Rule-based sharing suggestions: suggest only, owner confirms, suggestion + decision audited (T-40 to T-43) | ✅ (no AI model) |
| What we chose not to build, and why | Listed in THREATS.md and WRITEUP.md | ✅ |

## 5. Do's

- [x] Use AI and document it honestly (PROMPTS.md names the tool and its mistakes)
- [x] Commit as you go, in your own name
- [x] Deploy early and test the live link (done; also test on your phone in a private window)
- [x] Keep PROMPTS.md as you go (6 entries)
- [x] Say honestly what is unfinished (README, WRITEUP, THREATS "Accepted" rows)
- [x] Tests that really test the checks (mutation check)
- [ ] Record the 5-minute demo video
- [ ] Rewrite the write-up in your own words
- [ ] Practise explaining `authorizeDocument()` and the download route; know what happens if a line is removed
- [ ] Fill in the form and tick "I am done" before 6 PM
- [ ] At 6 PM: make the repo public, open the repo and the live site in incognito
- [ ] Ask your placement cell if anything is unclear

## 6. Don'ts (breaking these can mean rejection)

- [x] Don't let another person write any part of the code (Mark does not contribute)
- [x] Don't copy a tutorial, a found repository or another candidate's work
- [x] Don't share your repo, code or account with another candidate
- [x] Don't make the repo public before the deadline (it is private now)
- [x] Don't back-date commits or rewrite history
- [x] Don't claim features that don't work (README / form / video)
- [x] Don't hide that you used AI
- [x] Don't attack Snovasys systems or other candidates' deployments (only our own site was tested)
- [ ] Don't submit code you can't explain: read `authz.js`, `audit.js`, `session.js` and `routes/documents.js` before the interview
