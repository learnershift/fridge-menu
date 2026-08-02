# Project operating rules

- This app operates under the SecondBrainOS app-development domain. Before problem, feature, monetization, market, distribution, or release decisions, read:
  - `/Users/timeabout/projects/second-brain/docs/domains/app-development/DOMAIN.md`
  - `/Users/timeabout/projects/second-brain/docs/domains/app-development/knowledge/creators/programming-zombie/knowledge.json`
  - `/Users/timeabout/projects/second-brain/docs/domains/app-development/knowledge/creators/programming-zombie/README.md`
- Treat creator-derived claims as research hypotheses only; preserve knowledge IDs, evidence, limits, and epistemic labels, and never treat them as market validation or execution authority.
- Canonical root: `/Users/timeabout/projects/fridge-menu`. Do not create duplicate project copies.
- Build the smallest complete global-market PWA described by README and current source.
- Use test-driven changes for behavior and run `npm test && npm run build` before committing.
- Do not wait between internally available steps: inspect, fix, test, commit, push, and verify in one run when possible.
- Keep generated `dist/` synchronized with the tested source because it is the deployable artifact.
- Never commit credentials, tokens, personal data, or production ad identifiers.
- Preserve local-first, no-account, no-tracking boundaries unless the owner explicitly changes them.
