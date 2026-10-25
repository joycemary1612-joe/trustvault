# PROMPTS.md: how I used AI, and where it was wrong

Tool used: **Claude Code (Claude Opus 5.5)** in the Claude desktop app, working in this repository.
I made the decisions and did every commit myself; the AI wrote most of the first drafts of code.
Each entry below is something that actually happened while building TrustVault.

**Context:** I could not open the problem statement page (`/project/1` redirected to the event page) until
the placement cell sent me the text on **25 Oct 2026**, the last day. All the work below happened on that day,
which is why the commit history covers hours, not a week. I did not back-date anything.

---

## Reused context / instructions

This is the brief I gave the tool at the start, and re-used whenever it drifted:

> Stack: React + Node.js (Express) + PostgreSQL. Adobe Spectrum-like look.
> Security is 35% + threat thinking 15%. Every document access must be decided on the server, in one
> place I can explain in an interview. Revocation must work on the very next request. The audit trail must
> record refused attempts and be tamper-evident. I commit myself. Tell me where you are unsure.

Design rules I held the tool to:
- One function decides document access: `authorizeDocument()` in `server/src/authz.js`.
- No caching of permissions, no signed download URLs, no JWTs: anything issued must die on revoke.
- Outsiders get **404** (not 403) so they cannot learn a document exists.
- Admin is **not** a super-user over documents: admin manages people and reads the audit trail only.

---

## Entry 1 (25 Oct 2026): the mutation checker said every test was good, but no test ran (authorisation tests)

**What I asked:** "The judges will remove one authorisation check and run our tests. Write a script that removes
each check in turn and confirms a test fails."

**What it produced:** `server/scripts/mutation-check.mjs`. First run: `14/14 caught. Every removed check was caught by a test.`

**What was wrong:** It ran `node --test test/`, and that path form had already failed earlier in the same
session with `Cannot find module ...\server\test`. So every run **crashed before any test executed**, the exit
code was non-zero, and the script counted the crash as "mutation caught". A perfect score that proved nothing.
I only noticed because 14 out of 14 on the first try looked too good.

**What I did instead:** The script now (1) runs the untouched code first and refuses to continue unless that
baseline passes, and (2) counts a mutation as caught only if the TAP output shows real tests with `# fail N`
where N ≥ 1, not just a non-zero exit code.
Commit: _(add link: "Add mutation check for authorisation tests")_

## Entry 2 (25 Oct 2026): a hole in my tests for deactivated users (access control)

**What I asked:** Once the checker was fixed, I ran it again.

**What it produced:** `BAD missed  deactivated users keep their sessions`.

**What was wrong:** The AI's session lookup checks `AND u.is_active`, and the admin "deactivate" route also
deletes all of that user's sessions. Test T-08 only went through the route, so removing the `is_active` check
changed nothing the test could see. That check was **untested**: if a future change ever deactivated a user
without deleting sessions (a bulk import, a direct SQL fix, a new route), nothing would catch a live session
surviving.

**What I did instead:** Added test **T-08b**, which deactivates the user directly in the database (no session
cleanup) and asserts the existing session gets `401`. Re-ran the checker: all 14 mutations caught.
Commit: _(add link: "Test the is_active session check on its own")_

## Entry 3 (25 Oct 2026): test helper used `await` inside a non-async function

**What I asked:** "Write tests proving a user without a grant gets 404 on every document route."

**What it produced:** A list of arrow functions, one of which was
`() => victor.put(\`/grants/${await ctx.userId('victor')}\`)`, which is `await` inside a non-async arrow.

**What was wrong:** The whole test file failed to load (`SyntaxError: Unexpected reserved word`), so **none**
of the access tests in it ran, while the other test file still reported passes. A partial green run that hid a
file of zero tests.

**What I did instead:** Looked up the user id once before building the list. I now check the test **count**
(`pass 26`) after every run, not just "no failures".
Commit: _(add link)_

## Entry 4 (25 Oct 2026): dependency versions that do not install together

**What I asked:** Scaffold the React client with Vite.

**What it produced:** `npm i -D vite@7 @vitejs/plugin-react`, which failed with `ERESOLVE` because the latest
React plugin needs Vite 8.

**What was wrong:** It pinned a major version from memory instead of checking what fits together.

**What I did instead:** Installed matching latest versions (`vite@8`, `@vitejs/plugin-react@6`) and checked
`npm view` before pinning anything else.
Commit: _(add link: "React client")_

## Entry 5 (25 Oct 2026): login rate limit that password spraying walks straight past (authentication)

**What I asked:** "Add rate limiting to login so passwords can't be brute-forced."

**What it produced:** One `express-rate-limit` limiter keyed on `ip + "|" + email`, 10 attempts per 15 minutes.

**What was wrong:** That stops guessing many passwords for **one** account, but an attacker trying one or two
common passwords against **every** account from the same IP gets a fresh counter for each email, so they are
never slowed down. I spotted this while writing the sign-in rows of THREATS.md, asking "what does the limiter
count?". No test covered it, because the tests set the limit to 1000.

**What I did instead:** Added a second limiter per IP alone (50 per 15 minutes) in front of the per-account one,
and two tests that each build their own app with small limits: T-36 (7 different emails from one IP → the 6th
and 7th get 429) and T-37 (5 guesses at one account with a limit of 3 → 429). In THREATS.md I still mark this
**Partial**, because the counters live in memory and a botnet with many IPs is not stopped.
Commit: _(add link: "Throttle login per IP as well as per account")_

## Entry 6 (25 Oct 2026): the audit trail recorded the proxy's IP, not the person's (audit trail)

**What I asked:** Earlier, "set up Express for deployment on Render" and "record the IP on every audit event".

**What it produced:** `app.set('trust proxy', 1)` with the comment "Render puts one proxy in front of us; req.ip
is the real client", and `ip: req.ip` in every audit row. Every local test passed.

**What was wrong:** On the live site the admin's audit table showed IPs like `10.29.8.12` and `10.29.58.213` for
every user. Those are Render's internal proxies: traffic goes through Cloudflare **and** Render's load
balancers, so there is more than one hop. The record could not show *where* a refused attempt came from. It also
meant the per-IP login limit counted Render's handful of proxy addresses, so every real user shared one bucket.
The AI's comment stated an assumption about Render as a fact, and nothing local could have caught it. I only saw
it by looking at the deployed audit trail.

**What I did instead:** A small middleware sets `req.clientIp` from `CF-Connecting-IP`, the header Render's
Cloudflare edge sets and overwrites, **only** when the deployment sets `CLIENT_IP_HEADER` (in `render.yaml`).
Otherwise it falls back to `req.ip`, so locally nobody can choose their own IP. Audit rows and both login
limiters use `req.clientIp`. Test T-38 checks both cases; on the live site I sent a forged header and checked
what the audit row recorded.
Commit: _(add link: "Record the real client IP behind Render's proxies")_

---

_More entries are added below as I review the code._
