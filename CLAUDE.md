# CrowdX: notes for Claude

Hackathon project (MUICT x The Mall Group). It uses a mall's existing CCTV to count event
visitors in real time, with detection + tracking and **no face storage** (PDPA). The visitor
count feeds two engines: a **Business Engine** (break-even, cost per visitor, spillover to other
zones) and a **Carbon Engine** (GHG Protocol footprint using TGO emission factors). Output is one
dashboard showing value per person and carbon per person, which can back a "Green Event"
certificate for The Mall Group's Go to Zero goal.

See README.md for the folder layout, setup, run commands and API.

## Environment (Windows)

- Python: **always use `C:\cxenv\Scripts\python.exe`**. The Microsoft Store Python 3.13 can't
  install torch because of the Windows path-length limit. Packages: ultralytics, supervision,
  opencv, requests, lap. CPU only, no GPU: about 3 fps on 4K input at `--imgsz 1280`.
- Node 24, Express 5. In Express 5, `app.listen` does **not** crash when port 3000 is already
  taken: it prints "Running on port 3000" and then exits with code 0. If the backend "starts then
  exits", look for an old `node server.js` holding the port.
- When running servers in the background, start `node server.js` directly, not `npm start`.
  Stopping `npm` leaves its `node` child running.
- Sample videos (real mall footage isn't available yet):
  - `Sample01.mp4` (event `expo`): 4K portrait (2160x3840), 12.5 s, high angle over an expo aisle.
  - `Sample02.mp4` (event `lego`): 2880x1628, 18 s, high angle over a LEGO exhibit in a mall atrium.
    People are small, so use `--imgsz 1920` (1280 found 16 of ~60 people in a frame, 1920 found 52).
    It has a stock-site watermark and player bar, so check its license before showing it publicly.
- The frontend calls the API at a hard-coded `http://localhost:3000`, even when the page is served
  from another port. To test new backend code without stopping the user's server, run it on another
  port (monkeypatch `express.application.listen`), but use curl for the API; pages on that port
  still show port 3000's data.
- Visual check without a browser tool: headless Edge,
  `msedge --headless=new --screenshot=out.png --window-size=1400,1000 --virtual-time-budget=6000 <url>`
  (use a separate `--user-data-dir`).

## Design decisions (keep these)

- Count a person as an event visitor when their track's feet (bottom-center of the box) stay
  inside the event zone polygon for `--min-dwell` seconds. Don't count every new track ID: on
  dense CCTV, ByteTrack defaults gave 144 IDs for about 35 people. `tracker_crowd.yaml`
  (`new_track_thresh` 0.5, `track_buffer` 90) brought it to 67. At 2 s dwell: Sample01 gives 29
  visitors; Sample02 at `--imgsz 1920` gives 64 from 143 track IDs with ~40 people detected at a
  time, so it likely double counts. Neither is checked against a hand count yet.
- Draw the zone tightly around the event footprint (booths/carpet plus a small margin for
  people browsing at the edge), not the public walkways. The sample is an open event entered
  from every side; an earlier zone covering both walkways gave 40 instead of 29. For open
  events the counting line is secondary; zone + dwell is the real count.
- Store only aggregates. No faces, saved frames or track IDs. Preview frames for the dashboard
  monitor stay in backend memory (latest frame only).
- Zone and line geometry are fractions (0–1) of the frame, set per camera.
- The counter POSTs **deltas** (`{count: n}`) to `/api/update`, keeps unsent counts when a post
  fails, and sends any remainder when it exits.
- Multiple events: `server.js` keeps separate state per event (`EVENT_INFO`: count, Event Setup,
  history, camera frame), chosen with `?event=<id>` (default `expo`). The counter targets an event
  through its URLs (`--post-url .../api/update?event=lego`), so `count.py` has no event option.
  `event.html?event=<id>` shows one event; the hub reads `/api/events`.
- Camera modal shows one camera per event: live MJPEG from `/api/stream?event=<id>` when the
  counter is sending frames, otherwise the event's raw sample video labelled "AI offline". No fake
  boxes. The old MRT Link camera was removed at the user's request.
- Frontend libraries (Tailwind 3.4.17, Chart.js 4.5.1, html2pdf 0.10.1, Inter font) are saved in
  `frontend/vendor/` so the demo works without internet. Don't switch back to CDN links.
- UI style lives in `frontend/theme.css`, shared by both pages: light theme, Inter, white cards with
  soft shadows, glass sticky top bar (`.cx-topbar`), segmented tabs (`#nav-menu`, `#filterBar`),
  icon chips (`.cx-icon-*`). Restyle through theme.css rather than per-page `<style>`, and keep
  element IDs unchanged (the scripts depend on them). The logo is
  `assets/CrowdX_Geometric_Tech_Logo.png` (user-supplied, don't edit); `crowdx-mark.png` and
  `crowdx-favicon.png` are transparent crops of its "C" mark. Brand blue in the logo is about #1d7cf2.
- Headless screenshots of tabs can look faded (fade-in animation caught mid-way); add
  `--force-prefers-reduced-motion`.
- Don't overclaim on the dashboard or in the report. Label example numbers as illustrative, call the
  0.40 kgCO2e/pax threshold a CrowdX draft (not an official certification), and never say cameras
  detect travel modes.
- Started from github.com/deeptibhegde/Real-Time-Multiple-Person-Recognition-and-Tracking-for-CCTV-Camera
  only as a reference. **None of its code is used**: it's face recognition, which conflicts with
  no-face-storage.

## Known gaps / next steps

- **Business Engine is real (break-even only).** Visitor count starts at 0 (camera only). Costs and
  revenue come from the Event Setup form; R is locked to expected visitors (framework option A);
  forecast uses the last-10-minute pace. The team chose this scope: carbon and spillover come later.
- **Carbon is partly real.** The Carbon page (teammate's code) computes Scope 1/2/3 from a form with
  factors in `EF` in `event.html`, labelled TGO but **not cited** (no table name or year). Never
  invent or "fix" factor values; they must come from TGO's published tables. Open problems for the team:
  - Every visitor is assumed to make a 20 km round trip by car = 3.40 kgCO2e/pax, so the 0.40 draft
    threshold can never be met (always "Review Needed"). Needs a sourced threshold or travel model
    (visitor survey).
  - `server.js` still **randomizes** `carbon.perVisitor` and `travelModes`. The hub shows that random
    value, so the hub and event dashboard disagree on carbon.
- **Spillover** (+10.4% and per-zone %) is hard-coded and labelled "Illustrative". It needs
  people counting in other mall zones.
- Booth staff inside the zone count as visitors. Someone occluded for more than about 3 s can be
  counted twice. `--loop` re-counts the same people on every pass, so it's for demos only.
- Validate accuracy by hand-counting a clip before quoting numbers.

## Working with this user

- Before restructuring or changing their existing files, ask first. They originally asked that
  the original files not be disturbed, then explicitly approved the backend/frontend split.
- Code comments in `server.js`, `index.html` (hub) and `event.html` (dashboard) are in Thai. Match that style there.
- Commit only when asked, and never add Claude attribution (Co-Authored-By or "Generated with")
  to commits or PRs.
- Shared repo github.com/Sannn-boo/CrowdX (owner Sannn-boo; teammates WRNT-P and Poonyaphat-P push
  to `main` too). Pull before starting work. A teammate once force-pushed `main`; if a pull
  conflicts, compare the local commits with `origin/main` before resolving anything (they may
  already be there under new hashes).
- Teammates own the Business Engine (break-even, Event Setup), the hub page and the Carbon page.
  Tell the user when a change touches their code, so they can let the owner know.
- As of 2026-10-11, **not committed yet**: the multi-event backend (`?event=`), the LEGO event card
  and `Sample02.mp4`, `frontend/vendor/`, the honest-wording fixes in `event.html`, and the UI
  redesign (`theme.css`, logo in `frontend/assets/`).
