# One Caddy, several projects

The Caddy container in this stack (`grcwisdom-caddy-1`) is the server's only entrance on ports 80 and 443. Besides GRC Wisdom it serves:

| Project | Sites | Containers |
|---|---|---|
| Asset management | `assets.grcwisdom.com`, `assetsapi.grcwisdom.com`, `assetsfiles.grcwisdom.com` | `assetsmanagement-frontend-1`, `assetsmanagement-api-1`, `assetsmanagement-minio-1` |
| Phishing simulator | `phish.grcwisdom.com`, `admin-phish.grcwisdom.com` | `gophish-0121-gophish-1` |

## Why a GRC Wisdom deploy used to take those sites down

1. **The deploy replaced the Caddyfile.** It copied `deploy/Caddyfile` over `~/grcwisdom/Caddyfile` and reloaded Caddy. The other projects' blocks had been added to that file by hand, so every deploy deleted them.
2. **Caddy lost its way to their containers.** Caddy reached them because it had been attached by hand to their Docker networks. Whenever a deploy recreated the Caddy container, those attachments were dropped.
3. **Deploys recreated Caddy whenever a new Caddy came out (QA-037).** Each deploy pulled `caddy:2-alpine`, a tag that moves with every Caddy release, and `docker compose up` replaced the container when the image had changed. Every site on the server dropped, and 2. happened again. A reload that failed also fell back to restarting Caddy.

`git update-index --assume-unchanged Caddyfile` does not help. The deploy copies the file over the top without using git, and `assume-unchanged` is a performance hint rather than a lock: git still overwrites the file.

## How it works now

- **Their routes live in their own files on the server:** `~/grcwisdom/sites/*.caddy`, one per project. The Caddyfile ends with `import sites/*.caddy`, and the folder is mounted read-only into Caddy. The deploy copies only `docker-compose.yml` and `Caddyfile`, so it never writes into, changes or deletes `sites/`.
- **Caddy reaches them over a shared network, `caddy-edge`.** It's declared outside every project, so no project's deploy or `docker compose down` removes it. Caddy joins it in this stack's compose file; each other project joins it in its own.
- **A deploy never pulls, recreates or restarts Caddy (or Postgres).** It pulls only the GRC Wisdom `api` and `web` images and replaces only those two containers. Caddy and Postgres are started if they aren't running, and otherwise left exactly as they are. Upgrading them is a deliberate step (below).
- **The Caddyfile changes only when it has to, and only safely.** The deploy uploads the new files to `~/grcwisdom/.incoming` and leaves the live ones alone until they're checked. If `deploy/Caddyfile` hasn't changed, Caddy isn't touched at all. If it has changed, the running Caddy first validates it, then the deploy compares it with what Caddy serves right now. If any site would disappear, the deploy stops before changing anything and names the site. Only then is the file swapped in, with a graceful reload. If the reload is refused, the old file is put back. Either way every site stays up.

## One-time move (on the server)

Do these in order. Steps 1 to 4 cause no downtime. Step 5 recreates the Caddy container once, so that it gets the shared network and the `sites` folder. Every site drops for a few seconds. Certificates are kept in the `caddy_data` volume.

**First, check whether it's already done.** If all three of these print what's shown, skip to step 6.

```bash
ls ~/grcwisdom/sites                                                    # assets.caddy  phish.caddy
docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' grcwisdom-caddy-1   # includes caddy-edge
docker exec grcwisdom-caddy-1 ls /etc/caddy/sites                       # assets.caddy  phish.caddy
```

**1. Create the shared network.** Deploys also do this if it's missing.

```bash
docker network create caddy-edge
```

**2. Attach what Caddy serves to it now.** This takes effect immediately and changes nothing else.

```bash
for c in grcwisdom-caddy-1 assetsmanagement-frontend-1 assetsmanagement-api-1 assetsmanagement-minio-1 gophish-0121-gophish-1; do docker network connect caddy-edge "$c"; done
```

**3. Make that permanent in the other two projects.** In each project's `docker-compose.yml`, add `caddy-edge` to the services Caddy proxies to, and declare the network as external:

```yaml
services:
  frontend:            # likewise api and minio; gophish in the phishing project
    networks:
      - default
      - caddy-edge
networks:
  caddy-edge:
    external: true
```

Apply it with `docker compose up -d` in that project, at a quiet moment. It recreates only that project's containers.

**4. Move their blocks into site files.** Create `~/grcwisdom/sites/assets.caddy` and `~/grcwisdom/sites/phish.caddy`, holding exactly the blocks from the old Caddyfile:

```caddy
# ~/grcwisdom/sites/assets.caddy — NWC asset management
assets.grcwisdom.com {
    encode gzip zstd
    reverse_proxy assetsmanagement-frontend-1:80
}

assetsapi.grcwisdom.com {
    encode gzip zstd
    reverse_proxy assetsmanagement-api-1:8000
}

assetsfiles.grcwisdom.com {
    encode gzip zstd
    reverse_proxy assetsmanagement-minio-1:9000 {
        header_up Host {host}
    }
}
```

```caddy
# ~/grcwisdom/sites/phish.caddy — Phish Eye simulator
phish.grcwisdom.com {
    encode gzip zstd
    reverse_proxy gophish-0121-gophish-1:8080
}

admin-phish.grcwisdom.com {
    encode gzip zstd
    reverse_proxy gophish-0121-gophish-1:3333 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-Proto https
    }
}
```

**5. Recreate Caddy once, at a quiet moment.** Deploys never recreate Caddy, so this is done by hand:

```bash
cd ~/grcwisdom && docker compose up -d --no-deps --force-recreate caddy
```

Then deploy GRC Wisdom as usual. Until the move is done, a deploy that would drop one of these sites stops and says which one, with Caddy left as it was.

**6. Check every site answers:**

```bash
for h in assets assetsapi assetsfiles phish admin-phish; do curl -sI "https://$h.grcwisdom.com" | head -1; done
```

## Day to day

- **Changing another project's routes:** edit its file in `~/grcwisdom/sites/`, then reload. A reload is graceful: nothing is dropped, and an invalid file is refused while the old configuration keeps running.

  ```bash
  cd ~/grcwisdom && docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
  ```

- **Adding a project:** put its containers on `caddy-edge` in its compose file, and add a `sites/<project>.caddy`.
- **After another project redeploys**, its containers get new internal addresses. If one of its sites answers 502 afterwards, run the reload above.
- **A deploy warns that the `caddy` or `db` service changed and is not applied.** Someone changed that service in `deploy/docker-compose.yml`. Apply it as in the next section.
- **Never add another project's blocks to `deploy/Caddyfile`.** The next deploy would carry them wherever that file goes, and ties three projects' routing to this repository.

## Upgrading Caddy or Postgres

Deploys never do this, because a new Caddy container drops every site on the server for a few seconds, and a new Postgres container drops GRC Wisdom. Do it at a quiet moment. Each command recreates only the one container it names.

```bash
cd ~/grcwisdom
docker compose pull caddy && docker compose up -d --no-deps caddy   # Caddy: every site drops briefly
docker compose pull db && docker compose up -d --no-deps db         # Postgres: GRC Wisdom drops briefly
```

The same `up -d --no-deps <service>` applies a changed `caddy` or `db` definition from `docker-compose.yml`. Leave out the `pull` to change only the definition. Back up the database first (`ls ~/grcwisdom/backups` lists the backup each deploy makes). `postgres:16-alpine` only ever moves within Postgres 16, so this never needs a data upgrade.
