# ── Remote Android Studio on the VPS, driven from a browser tab ───────────────
# No Docker. No emulator. Native X11 + VNC + noVNC, systemd-managed, OFF by default.
#
# WHAT THIS IS
#   Android Studio already sits unpacked on the box at /opt/android-studio. This stack
#   gives it a virtual display (Xvfb), a window manager (openbox), a VNC server bound to
#   127.0.0.1 (x11vnc) and a WebSocket bridge that serves the noVNC browser client
#   (websockify). The operator opens https://ide.tukuk.org in a tab; the IDE pixels are
#   streamed out of the box. Nothing is installed on the laptop, and no port is opened.
#
# WHY IT IS OFF BY DEFAULT (and this is the whole design, not a footnote)
#   The box has 6.8 GB. The site's Node origin alone holds ~845 MB, MeiliSearch is
#   configured for a 1.5 GB cache, and the Chrome pool can take 2 GB. Android Studio is a
#   2-4 GB JVM before Gradle starts thinking. An always-on IDE is therefore a site outage
#   waiting to happen, so:
#     * every unit is `systemctl enable`d as STOPPED (`systemctl disable` semantics would
#       still leave it pullable by the target; what matters is that nothing pulls the
#       target at boot — see the [Install] lines, which are deliberately absent);
#     * `ide-session.sh start` refuses to run unless it can name the memory it needs;
#     * `remote-ide-idle-stop.timer` puts the whole stack to sleep when the browser tab
#       closes, exactly like deploy/builder-idle-stop.sh does for the Builder;
#     * the IDE runs `Nice=10` with a `CPUQuota`, and the site's units keep priority.
#
# ACCESS CONTROL — three layers, because this thing is a remote desktop on a production
# box and "it is only on localhost" is not a security argument:
#   1. Cloudflare Access on ide.tukuk.org, enforced at the edge (Allow: None + an
#      identity or service-token rule). The origin is reachable ONLY through the tunnel,
#      so a visitor without a valid Cf-Access-Jwt-Assertion never reaches nginx.
#   2. nginx refuses any request that carries no Access header at all (deploy/nginx/
#      tukuk-ide.conf). Useless if the edge is ever bypassed, load-bearing if someone
#      later adds a public ingress to :3000 by accident — which is precisely the mistake
#      this repo's history says will be made eventually.
#   3. x11vnc requires a real RFB password. Layer 3 is the one that still works if 1 and 2
#      both rot, and it authenticates the actual protocol, not just the URL.
#
# ── BRING IT UP (root, on the box) ──────────────────────────────────────────────
#   cd /opt/tukuk-os && git pull
#   sudo bash deploy/ide/install-remote-ide.sh
#   # then, as the tukuk user, for a session:
#   bash /opt/tukuk-os/deploy/ide/ide-session.sh start
#   bash /opt/tukuk-os/deploy/ide/ide-check.sh          # staged proof, see below
#   bash /opt/tukuk-os/deploy/ide/ide-session.sh stop   # or just close the tab and wait
#
# ── DASHBOARD SIDE (cannot be automated with the current API token) ─────────────
#   The token has no Zone:Access and no Zone:Rules scope, so these are dashboard clicks:
#   1. Zero Trust → Access → Applications → add `ide.tukuk.org`, Self-hosted,
#      destination `ide.tukuk.org/*`, session duration 8h.
#   2. Add an Allow policy for your own e-mail (or a Service Token, and then send
#      CF-Access-Client-Id / CF-Access-Client-Secret from whatever proxies it).
#   3. Tunnel route: `ide.tukuk.org -> http://127.0.0.1:3000` on the ONE tunnel
#      (`c1d8ea0f`), added in the dashboard — it is remote-config, so a local ingress file
#      is ignored. The same rule that play.tukuk.org and tchat.tukuk.org follow. Do not
#      create a second connector to bypass it: deploy/cloudflared/config.yml is the list.
#   4. The dashboard route also creates the DNS record; no `tunnel route dns` needed.
#
# ── WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ────────────────────────────────────
#   Good: reading the box, editing project files, watching a build fail with the real
#   IDE's error pane, running one Gradle sync, repairing a project's config.
#   Bad: shipping. The APK pipeline does not need any of this — scripts/build-apk.sh and
#   the on-demand /api/apk/:id route already chain aapt2 → javac → d8 → zipalign →
#   apksigner headlessly in a few seconds and cost a few hundred MB instead of 4 GB. If
#   the goal is "make an app on the website", that path (and build.tukuk.org) is the one
#   to use; this stack is the wrench, not the factory.
#   Expect the picture to be soft over a slow line: it is VNC, so it is latency-bound,
#   and no amount of tuning makes typing feel local. IDE_SCALE in the VNC unit trades
#   resolution for bandwidth if the link is bad.
#
# ── THE SYSTEMD VARIABLE-EXPANSION TRAP (why some values here are duplicated on purpose)
#   systemd does NOT expand ${VAR} everywhere one would assume it does. Three specific
#   places in this stack got bitten by this, and it is worth knowing before editing any
#   of these unit files:
#     * Environment= is a plain assignment, not a command line. Environment=DISPLAY=${IDE_DISPLAY}
#       literally sets DISPLAY to the text "${IDE_DISPLAY}", and every X client started by
#       that unit then fails "cannot open display" with an unusable name in the error. wm,
#       terminal and studio all use a real shell instead
#       (ExecStart=/bin/sh -c 'exec env DISPLAY="$IDE_DISPLAY" ...'), since a shell DOES
#       expand variables, and the EnvironmentFile= values are a normal environment by the
#       time that shell runs.
#     * The first word of ExecStart (the program itself) is never variable-expanded, only its
#       arguments. ${IDE_STUDIO_DIR}/bin/studio.sh as a command path is a hard parse failure
#       ("Neither a valid executable name nor an absolute path") -- studio.service puts the
#       whole thing inside `sh -c` for this reason too, not just the DISPLAY one.
#     * Resource-control directives (MemoryMax=, CPUQuota=) do not expand variables AT ALL,
#       in any position, and a value systemd cannot parse there is only a journal warning --
#       the unit still starts, just with no limit applied. This is the dangerous one: a
#       MemoryMax=${IDE_MEM_MAX} that quietly does nothing is exactly the failure this whole
#       design exists to prevent (an IDE runaway eating the live site's memory). remote-ide-
#       studio.service hard-codes 4G/250% instead, and install-remote-ide.sh refuses to finish
#       unless /etc/tukuk-ide/env says the same numbers -- that check is the only thing
#       keeping the duplication honest instead of a silent drift waiting to happen.
