# Fridge Menu

A dependency-free, installation-free local PWA that turns 3–8 fridge ingredients into three deterministic use-first meal directions.

## Run locally

```sh
npm test
npm run build
npm start
```

Open `http://127.0.0.1:4173`. The app stores its versioned ingredient list only in browser `localStorage`. It has no account, backend, analytics, tracking, remote API, or external runtime dependency.

## Deterministic menu rule

Ingredients sort by earliest valid expiry date, then insertion order for matching dates. The three meal directions anchor the first, second, and third sorted ingredient respectively, with remaining ingredients rotated in the same stable order. Expired ingredients remain visible so they can be removed, but are not accepted or used to generate meal directions.

## Advertising boundary

The visible advertising area is a nonfunctional test placeholder. It loads no SDK, makes no ad request, and contains no production account, credential, secret, or ad-unit identifier. Google AdMob is only a future product direction. Subscription, paid tier, checkout, pricing, and affiliate activation are deferred.

## Evidence boundary

Local build, automated tests, and local browser interaction can prove only that this prototype works locally. They do not prove market demand, user outcomes, revenue, advertising policy compliance, store readiness, publication, or production-ad behavior.
