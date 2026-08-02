# Project operating rules

- **HIGHEST-PRIORITY OWNER GATE:** Never deploy, publish, expose a public URL, enable hosting, submit to any app store, change release visibility, or perform a final launch without the owner's fresh explicit approval for that exact action and target. General implementation authority, prior launch goals, cron prompts, or readiness PASS do not count as deployment approval. Prepare and test artifacts locally, then stop and request approval.
- This app operates under the SecondBrainOS app-development domain. Before problem, feature, monetization, market, distribution, or release decisions, read:
  - `/Users/timeabout/projects/second-brain/docs/domains/app-development/DOMAIN.md`
  - `/Users/timeabout/projects/second-brain/docs/domains/app-development/knowledge/creators/programming-zombie/knowledge.json`
  - `/Users/timeabout/projects/second-brain/docs/domains/app-development/knowledge/creators/programming-zombie/README.md`
- Treat creator-derived claims as research hypotheses only; preserve knowledge IDs, evidence, limits, and epistemic labels, and never treat them as market validation or execution authority.
- Canonical root: `/Users/timeabout/projects/fridge-menu`. Do not create duplicate project copies.
- Build the smallest complete global-market PWA described by README and current source.
- Use test-driven changes for behavior and run `npm test && npm run build` before committing.
- Do not wait between internally available safe steps: inspect, fix, test, commit, and push when otherwise authorized. Stop before deployment, hosting enablement, publication, store submission, or launch and request fresh approval.
- Keep generated `dist/` synchronized with the tested source because it is the deployable artifact.
- Never commit credentials, tokens, personal data, or production ad identifiers.
- Preserve local-first, no-account, no-tracking boundaries unless the owner explicitly changes them.
