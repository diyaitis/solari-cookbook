/**
 * Price / restock watcher — check a list of product pages on a schedule and
 * fire a webhook when a price drops or a status string (e.g. "In stock")
 * changes. Point it at real storefronts and cron it (see the GitHub Actions
 * workflow in this repo) and it's a working deal-alert / restock-alert bot.
 *
 * Why a cloud browser instead of a plain HTTP GET: most storefronts render
 * price/availability client-side and increasingly gate scraping traffic
 * behind bot checks. `stealth` + `proxy` on `solari.launch()` are the two
 * knobs that get you past that; a profile (see browser-profiles-ts) does the
 * same for pages that require being logged in, e.g. a wishlist.
 *
 * State (last-seen value per item) is kept in a local JSON file so re-runs
 * only alert on a *change*, not on every check.
 */
import { readFile, writeFile } from "node:fs/promises"
import { Solari } from "@solarisdk/browser"

type Mode = "price" | "text"

interface WatchItem {
  name: string
  url: string
  selector: string
  mode: Mode
  targetPrice?: number
  stealth?: boolean
  proxy?: string
  profileId?: string
}

interface ItemState {
  value: string
  price?: number
  checkedAt: string
}

const watchlistPath = process.env.WATCHLIST_PATH ?? "./watchlist.json"
const statePath = process.env.STATE_PATH ?? "./state.json"
const webhookUrl = process.env.WEBHOOK_URL

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T
  } catch (err: any) {
    if (err.code === "ENOENT") return fallback
    throw err
  }
}

function parsePrice(text: string): number | null {
  const match = text.replace(/,/g, "").match(/[\d.]+/)
  return match ? Number.parseFloat(match[0]) : null
}

async function notify(message: string) {
  console.log(`ALERT: ${message}`)
  if (!webhookUrl) return
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: message, text: message }),
    })
    // fetch only rejects on network failure — a 404/401 from a bad webhook
    // URL resolves normally and would otherwise look like a delivered alert.
    if (!res.ok) {
      console.error(`webhook delivery failed: ${res.status} ${res.statusText}`)
    }
  } catch (err: any) {
    console.error("webhook delivery failed:", err.message)
  }
}

async function checkItem(
  solari: Solari,
  item: WatchItem,
  previous: ItemState | undefined,
): Promise<ItemState> {
  const browser = await solari.launch({
    stealth: item.stealth ?? false,
    ...(item.proxy ? { proxy: item.proxy } : {}),
    ...(item.profileId ? { profileId: item.profileId } : {}),
  })
  try {
    const page = await browser.newPage()
    await page.goto(item.url, { waitUntil: "domcontentloaded" })
    const text = (await page.locator(item.selector).first().innerText()).trim()
    const checkedAt = new Date().toISOString()

    if (item.mode === "price") {
      const price = parsePrice(text)
      if (price == null) {
        console.warn(`[${item.name}] could not parse a price out of "${text}"`)
        return { value: text, checkedAt }
      }

      const droppedFromPrevious = previous?.price != null && price < previous.price
      const crossedTarget =
        item.targetPrice != null &&
        price <= item.targetPrice &&
        (previous?.price == null || previous.price > item.targetPrice)

      if (droppedFromPrevious || crossedTarget) {
        await notify(
          `${item.name}: price is now $${price}` +
            (previous?.price != null ? ` (was $${previous.price})` : "") +
            // Only claim the target was hit when that's actually why this fired —
            // otherwise a plain drop-from-previous alert wrongly implied the
            // target price had been reached.
            (crossedTarget ? ` — target was $${item.targetPrice}` : "") +
            `\n${item.url}`,
        )
      }
      console.log(`[${item.name}] $${price}`)
      return { value: text, price, checkedAt }
    }

    // mode === "text": alert on any change to the watched string.
    if (previous && previous.value !== text) {
      await notify(
        `${item.name}: status changed from "${previous.value}" to "${text}"\n${item.url}`,
      )
    }
    console.log(`[${item.name}] ${text}`)
    return { value: text, checkedAt }
  } finally {
    await browser.close()
  }
}

async function main() {
  const watchlist = await loadJson<WatchItem[]>(watchlistPath, [])
  if (watchlist.length === 0) {
    console.log(`No items in ${watchlistPath}. Copy watchlist.example.json to get started.`)
    return
  }

  const state = await loadJson<Record<string, ItemState>>(statePath, {})
  const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! })

  let hadFailure = false
  try {
    for (const item of watchlist) {
      try {
        state[item.name] = await checkItem(solari, item, state[item.name])
      } catch (err: any) {
        console.error(`[${item.name}] check failed: ${err.message}`)
        hadFailure = true
      }
    }
  } finally {
    await writeFile(statePath, JSON.stringify(state, null, 2))
    // Required, or the process never exits — the client keeps a loopback
    // proxy open for connection retries.
    await solari.close()
  }

  // A per-item failure (bad selector, site down, etc.) is swallowed above so
  // one broken item doesn't stop the rest from being checked — but the run
  // should still show red in CI, or a broken watch could go unnoticed for
  // months with the Actions tab reporting all-green the whole time.
  if (hadFailure) process.exitCode = 1
}

await main()
