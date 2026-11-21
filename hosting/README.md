# League Layer's site on Cloudflare

The site's files are served by Cloudflare (a Worker with only static assets, `leaguelayer-site`, in `wrangler.toml` here),
on the same account as the domain and the API Worker (`worker/`). Why it moved from GitHub Pages (Nov 21, 2026): no
bandwidth limit (Pages' soft 100 GB a month was ~2,000 visits a day), and a file is marked by its contents, so after a
deploy an unchanged file (the 740 KB photo sheet, the fonts, finished months) isn't sent again: Pages re-sent every file
after each of its 15-30 deploys a day. `_headers` here keeps the code (`?v=<build>`) in the browser for good.

The site workflow's deploy job publishes there after GitHub Pages, on every run, once the token below is in GitHub
(`CLOUDFLARE_ACCOUNT_ID` is a repository variable, set Nov 21, 2026); until then the step is skipped. Only that step
sees the token. Claude never runs wrangler for it.

## One-time setup (the owner's)

1. **A Cloudflare token** that can publish Workers: https://dash.cloudflare.com/profile/api-tokens, **Create Token**,
   the **Edit Cloudflare Workers** template, **Use template**. The page (2026) has no "Account Resources" section any
   more: each policy under **Permission policies** has its own resource dropdown. The defaults are fine (one account);
   the zone policy may be narrowed to `leaguelayer.com`. **Continue to summary** (or **Review token**), **Create Token**,
   and copy it (it's shown once).
2. **Into GitHub**: the repository's **Settings**, **Secrets and variables**, **Actions**, **New repository secret**.
   Name `CLOUDFLARE_API_TOKEN`, paste the token, **Add secret**.
3. The next run (any push, or Actions, "Refresh data and publish site", **Run workflow**) publishes the site at
   `https://leaguelayer-site.<the account's subdomain>.workers.dev` (the run's "Publish to Cloudflare" step prints it).
   There the live feed, injury watch, error log and analytics don't answer (they're for leaguelayer.com only), so live
   scores come from ESPN directly: everything else works as on leaguelayer.com.

## Moving leaguelayer.com (no gap: any time)

The deploy already routes `leaguelayer.com/*` to `leaguelayer-site` (`wrangler.toml`); the route only takes over once the
name's records go through Cloudflare. In https://dash.cloudflare.com, the leaguelayer.com domain:

1. **SSL/TLS**, **Edge Certificates**: turn **Always Use HTTPS** on (it was off: `http://` addresses weren't sent to
   `https://`, which GitHub Pages did; it covers api.leaguelayer.com too, harmlessly).
2. **DNS**, **Records**: each of the four `A` records named `leaguelayer.com` (185.199.108.153, .109, .110, .111:
   GitHub's), **Edit**, turn **Proxy status** on (orange), **Save**. From then on Cloudflare answers for the name and
   the route serves the site; GitHub's address is never reached.
3. **www** (when convenient): the `www` CNAME (`eli-cb.github.io`), **Edit**, **Proxy status** on, **Save**; then
   **Rules**, **Templates** (or **Redirect Rules**), "Redirect from WWW to root", **Deploy**. Until then www goes on to
   GitHub, which redirects it to leaguelayer.com while its certificate lasts (it can't renew with the name on Cloudflare).

GitHub Pages stays published with its custom domain set (its settings will say the DNS check failed: leave it): the
old eli-cb.github.io/courtside-manager/ links still redirect to leaguelayer.com, and while www points to
eli-cb.github.io, unpublishing would let another GitHub user claim www.leaguelayer.com.

**Going back**: turn the four records' proxy off (DNS only) and GitHub Pages serves the name again (its copy as of its last deploy).
