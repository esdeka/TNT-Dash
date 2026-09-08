# Show the commute dashboard inside Home Assistant

Two supported setups. **Option A** is recommended for a pure overview —
zero infrastructure, builds entirely on the serverless static page.
**Option B** uses the packaged add-on when you also want the departures
entities API (`/api/next`, `/api/plan-train`) running on the same machine.

## Option A — static page in `/local`, Webpage dashboard (recommended)

`Dashboard.html` is fully self-contained (timetable, walks, PDF, font,
code) and can call the STIB, De Lijn and iRail APIs itself; nothing
needs to run on the HA machine. All upstream gateways are
CORS-permissive (verified), including from an iframe.

1. **Build the page** — with your private key files referenced, build.py
   also writes the git-ignored `Dashboard-secrets.js`:

   ```bash
   BMC_API_KEY_FILE=/home/user/.secrets/commute/bmc_key \
   DELIJN_API_KEY_FILE=/home/user/.secrets/commute/delijn_key \
   python3 commute/build.py
   ```

2. **Copy both files onto HA**: `config/www/commute/index.html` (rename
   of `Dashboard.html`) and `config/www/commute/Dashboard-secrets.js`,
   via Studio Code Server, Samba, or SSH/scp. The page then serves at
   `https://<your-ha>/local/commute/index.html` and loads the sibling
   secrets file from the same folder — rotate keys by editing that file,
   no rebuild. Only host where you alone can reach it (the secrets file
   contains the keys).

3. **Add it to the sidebar** — no restart needed:
   *Settings → Dashboards → Add dashboard → Webpage*, then:

   | Field | Value |
   |---|---|
   | URL | `/local/commute/index.html` |
   | Title | Commute |
   | Icon | `mdi:bus` |

   The dashboard appears at `/webpage/` (your chosen URL path). Do not
   use the removed `panel_iframe:` YAML — current HA versions import it
   automatically and nag; the Webpage dashboard is the native equivalent.

### Notes for Option A

- `/local/…` is served **without HA authentication**. Anyone who can
  reach your HA address can download the page and the secrets file —
  including the keys it contains. That matches how you already intend
  to host it (a private host only you can reach); keep HA itself
  private/trusted by its own means. Instead of the file you can also
  paste keys per device under **Reference → API keys** (browser
  localStorage), which wins over the file.
- Live quotas persist in the browser's `localStorage` per origin — the
  HA panel has its own 80/day (anonymous) or 10,000/day (registered)
  counters, independent of the file copy on your laptop.
- The page is responsive down to 320 px, so it works in the companion
  app sidebar width too.
- After rotating your API keys, edit `Dashboard-secrets.js` on the HA
  host (or re-enter under Reference → API keys); no rebuild required.
- If you later host `Dashboard.html` on a separate static server inside
  your LAN, you can point the Webpage dashboard at that URL instead of
  `/local/…` — behavior is identical; same-origin storage is not
  required, only for the quota counters to share.

## Option B — HA OS add-on (dashboard + entities API)

`ha_app/` packages `server.py` as a Home Assistant OS add-on
("Commute dashboard"). Installing it serves the page with
`COMMUTE_SERVER=true` on port 3000 and keeps the keys server-side in
add-on options; HA shows the add-on's `webui` in the sidebar. Use this
when you also want the read-only departures API for template sensors
(`home_assistant/commute.yaml`) and the optional auto live-refresh
service (`home_assistant/optional_live_refresh.yaml`) running locally.
Both consumers are already documented in the repository.
