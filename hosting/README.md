# League Layer's site on Cloudflare

Since Nov 21, 2026 leaguelayer.com is served by Cloudflare: a Worker with only static assets, `leaguelayer-site`
(`wrangler.toml` here), on the same account as the domain and the API Worker (`worker/`). Why it left GitHub Pages: no
bandwidth limit (Pages' soft 100 GB a month was ~2,000 visits a day), and a file is marked by its contents, so after a
deploy an unchanged file (the 740 KB photo sheet, the fonts, finished months) answers "not modified" instead of coming
again: Pages re-sent every file after each of its 15-30 deploys a day. `_headers` here keeps the code (`?v=<build>`) in
the browser for good. Requests to it are free and count nowhere (not against the API Worker's 100,000 a day).

The site workflow's deploy job publishes it on every run (`npx wrangler deploy` there, with the `CLOUDFLARE_API_TOKEN`
secret and the `CLOUDFLARE_ACCOUNT_ID` repository variable; only that step sees the token). Claude never runs wrangler for it.

## How leaguelayer.com reaches it

A route, `leaguelayer.com/*` (in `wrangler.toml`, set by each deploy), on the name's four `A` records, which are
**Proxied**. The records still hold GitHub Pages' addresses (185.199.108.153, .109, .110, .111), but Cloudflare never
reaches them: the route answers every address. Not a Custom Domain: Cloudflare wouldn't attach one while those records
held the name, and deleting them first leaves a gap resolvers may remember 30 minutes. The zone's **Always Use HTTPS**
is on (SSL/TLS, Edge Certificates), turned on with the move: GitHub Pages had sent `http://` to `https://` itself.

**Going back**: turn the four records' proxy off (DNS only), and GitHub Pages serves the name again, with its copy from
its last deploy (Nov 21, 2026): the deploy steps for it would need putting back in site.yml (git history).

## www.leaguelayer.com (the owner's step, not done yet)

Its CNAME still points to `eli-cb.github.io`, DNS only. `http://www` is sent on to leaguelayer.com, but `https://www`
fails: GitHub shows its own `*.github.io` certificate there (checked Nov 21, 2026, after the move). To fix: the `www`
CNAME, **Edit**, **Proxy status** on, **Save**; then **Rules**, **Templates** (or **Redirect Rules**), "Redirect from
WWW to root", **Deploy**.

GitHub Pages stays published with its custom domain set (its settings say the DNS check failed: leave it): the old
eli-cb.github.io/courtside-manager/ links still redirect to leaguelayer.com through it, and while www points to
eli-cb.github.io, unpublishing it would let another GitHub user claim www.leaguelayer.com.

## The token

Made Nov 21, 2026 from the **Edit Cloudflare Workers** template (https://dash.cloudflare.com/profile/api-tokens; the
page has no "Account Resources" section any more: each permission policy has its own resource dropdown, and the
defaults do). It must keep Workers Scripts and the zone's Workers Routes permission (the route). If it expires or is
deleted, every deploy fails at "Publish to Cloudflare" and the site stays as it was: make a new one the same way and
replace the repository secret `CLOUDFLARE_API_TOKEN` (GitHub, Settings, Secrets and variables, Actions).
