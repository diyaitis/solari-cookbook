# Price / restock watcher (TypeScript)

Watch a list of product pages for a price drop or a status change (e.g. "Sold
out" → "In stock") and get pinged on a webhook when it happens. This is the
whole idea behind deal-alert and restock-alert products, built on a cloud
browser instead of a scraping-proxy service.

Why a real browser: modern storefronts render price/availability with
client-side JS and increasingly block plain HTTP scrapers. `solari.launch()`
gives you `stealth` (fingerprint patches, real GPU) and `proxy` (residential
egress by country) per item, so pages that block a naive scraper still work.
For pages that require login (a wishlist, a members-only price), attach a
[profile](../browser-profiles-ts) instead of logging in every run.

State is kept in `state.json` (gitignored) so you only get notified on a
*change*, not on every scheduled check.

## Run once, locally

```bash
cd examples/price-watcher-ts
npm install
cp .env.example .env        # fill in SOLARI_API_KEY, optionally WEBHOOK_URL
cp watchlist.example.json watchlist.json   # edit with the pages you care about
npm start
```

Each watchlist entry:

```jsonc
{
  "name": "label used in logs and alerts",
  "url": "https://example.com/product/123",
  "selector": ".price",          // CSS selector for the text to watch
  "mode": "price",                // "price" (numeric) or "text" (any change)
  "targetPrice": 49.99,           // optional, "price" mode only
  "stealth": true,                // optional, default false
  "proxy": "us",                  // optional, requires stealth: true
  "profileId": "profile_..."      // optional, for logged-in pages
}
```

## Run on a schedule

See [`.github/workflows/price-watcher.yml`](../../.github/workflows/price-watcher.yml)
in the repo root — it runs this example every 15 minutes on GitHub's
infrastructure. To use it in your fork:

1. Add repo secrets `SOLARI_API_KEY` and (optionally) `WEBHOOK_URL`.
2. Commit your own `examples/price-watcher-ts/watchlist.json`.
3. Enable Actions on the fork. That's the whole deployment.

`WEBHOOK_URL` accepts a Discord or Slack incoming-webhook URL as-is; anything
else that accepts a JSON POST with a `content`/`text` field also works.

Source: [`index.ts`](index.ts)
