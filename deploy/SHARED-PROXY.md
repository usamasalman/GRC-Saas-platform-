# One Caddy, several projects

The Caddy container in this stack (`grcwisdom-caddy-1`) is the server's only entrance on ports 80 and 443. Besides GRC Wisdom it serves:

| Project | Sites | Containers |
|---|---|---|
| Asset management | `assets.grcwisdom.com`, `assetsapi.grcwisdom.com`, `assetsfiles.grcwisdom.com` | `assetsmanagement-frontend-1`, `assetsmanagement-api-1`, `assetsmanagement-minio-1` |
| Phishing simulator | `phish.grcwisdom.com`, `admin-phish.grcwisdom.com` | `gophish-0121-gophish-1` |

## Why a GRC Wisdom deploy used to take those sites down

1. **The deploy replaces the Caddyfile.** It copies `deploy/Caddyfile` over `~/grcwisdom/Caddyfile` and reloads Caddy. The other projects' blocks had been added to that file by hand, so every deploy deleted them.
2. **Caddy lost its way to their containers.** Caddy reached them because it had been attached by hand to their Docker networks. Whenever a deploy recreated the Caddy container, those attachments were dropped.

`git update-index --assume-unchanged Caddyfile` does not help. The deploy copies the file over the top without using git, and `assume-unchanged` is a performance hint rather than a lock: git still overwrites the file.

## How it works now

- **Their routes live in their own files on the server:** `~/grcwisdom/sites/*.caddy`, one per project. The Caddyfile ends with `import sites/*.caddy`, and the folder is mounted read-only into Caddy. The deploy copies only `docker-compose.yml` and `Caddyfile`, so it never writes into, changes or deletes `sites/`.
- **Caddy reaches them over a shared network, `caddy-edge`.** It's declared outside every project, so no project's deploy or `docker compose down` removes it. Caddy joins it in this stack's compose file; each other project joins it in its own.
- **A broken site file cannot take anything down.** Before reloading, the deploy runs `caddy validate`. If a file is broken, the deploy stops, and Caddy keeps serving every site on the configuration it already had.

## One-time move (on the server)

Do these in order. Steps 1 to 4 cause no downtime. The deploy in step 5 recreates the Caddy container once, because its network and mounts change, so every site drops for a few seconds. Certificates are kept in the `caddy_data` volume.

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

**5. Deploy GRC Wisdom as usual.** The new Caddyfile imports the site files and Caddy joins `caddy-edge`.

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
- **Never add another project's blocks to `deploy/Caddyfile`.** The next deploy would carry them wherever that file goes, and ties three projects' routing to this repository.
