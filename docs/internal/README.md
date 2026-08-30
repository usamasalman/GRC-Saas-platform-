# Internal design documents

These were previously in `public/`, which Vite copies verbatim into `dist/`.
That meant they were served anonymously at the web root of any deployment —
`https://your-server/platform-guide.html` and so on — with no authentication.

`platform-guide.html` published the shared seed password and a table of working
sign-in addresses. The others disclose the tenancy model, provisioning
architecture and audit design: useful reconnaissance, and not something a
customer should find by guessing a URL.

They are kept here as documentation. Nothing in this directory is part of the
build. If any of it should be reachable from inside the product, serve it
through an authenticated route rather than moving it back.
