# Vercel configuration notes

`vercel.json` cannot hold comments. It is validated against a strict schema and
**any key Vercel does not recognise fails the build** — including a harmless
`_comment` field. Every deployment on 26 August 2026 failed with:

> The `vercel.json` schema validation failed with the following message:
> should NOT have additional property `_comment_noindex`

So notes about that file live here instead.

## X-Robots-Tag: noindex, nofollow

The site currently has **no custom domain attached** and is reachable only at
its `.vercel.app` URL. That header keeps the address out of search results, so
an unfinished salon site cannot turn up on Google.

**Remove that header the day `studioserena.no` is pointed at this project**,
or the real site will be invisible to search engines.

## Maintenance mode

There is no maintenance rewrite any more. If the site ever needs taking down
again, add a `rewrites` block sending everything except `maintenance.html` and
the search-verification files to `/maintenance.html` — and delete the whole
block to bring it back. Do not add a comment key to describe it.

## What Vercel builds

This is a static site: no framework, no build step. `.vercelignore` keeps
`supabase/` out of the upload, since those are Deno edge functions and SQL
migrations deployed with Supabase's own CLI.
