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
- Sample video: `backend/vision/samples/Sample01.mp4`, 4K portrait (2160x3840), 12.5 s, high
  angle over an expo aisle. Real mall footage isn't available yet.

## Design decisions (keep these)

- Count a person as an event visitor when their track's feet (bottom-center of the box) stay
  inside the event zone polygon for `--min-dwell` seconds. Don't count every new track ID: on
  dense CCTV, ByteTrack defaults gave 144 IDs for about 35 people. `tracker_crowd.yaml`
  (`new_track_thresh` 0.5, `track_buffer` 90) brought it to 67. On the sample, 29 visitors at
  2 s dwell (not yet checked against a hand count).
- Draw the zone tightly around the event footprint (booths/carpet plus a small margin for
  people browsing at the edge), not the public walkways. The sample is an open event entered
  from every side; an earlier zone covering both walkways gave 40 instead of 29. For open
  events the counting line is secondary; zone + dwell is the real count.
- Store only aggregates. No faces, saved frames or track IDs. Preview frames for the dashboard
  monitor stay in backend memory (latest frame only).
- Zone and line geometry are fractions (0–1) of the frame, set per camera.
- The counter POSTs **deltas** (`{count: n}`) to `/api/update`, keeps unsent counts when a post
  fails, and sends any remainder when it exits.
- Dashboard System Status modal: one camera only (Cam 1: Expo Hall, live MJPEG from
  `/api/stream`). Cam 2 (MRT Link) was removed at the user's request.
- Started from github.com/deeptibhegde/Real-Time-Multiple-Person-Recognition-and-Tracking-for-CCTV-Camera
  only as a reference. **None of its code is used**: it's face recognition, which conflicts with
  no-face-storage.

## Known gaps / next steps

- **Business Engine is real (break-even only).** Visitor count starts at 0 (camera only). Costs and
  revenue come from the Event Setup form; R is locked to expected visitors (framework option A);
  forecast uses the last-10-minute pace. The team chose this scope: carbon and spillover come later.
- **Placeholder data in the dashboard.** `server.js` still **randomizes** carbon per visitor and
  the MRT/Bus/Car split on every update. Spillover %, the scope breakdown and "15% below
  standard" are hard-coded in `index.html`. The PDF report says transport modes come from "visual detection", which isn't
  real: cameras can't tell how someone travelled to the mall. Proposed next step: real Business
  and Carbon engines computed from the live count. Carbon would use cited TGO emission factors
  (never invent factor values), with travel mode from a visitor survey.
- Booth staff inside the zone count as visitors. Someone occluded for more than about 3 s can be
  counted twice. `--loop` re-counts the same people on every pass, so it's for demos only.
- Validate accuracy by hand-counting a clip before quoting numbers.

## Working with this user

- Before restructuring or changing their existing files, ask first. They originally asked that
  the original files not be disturbed, then explicitly approved the backend/frontend split.
- Code comments in `server.js` and `index.html` are in Thai. Match that style there.
- Commit only when asked. As of 2026-10-10, the backend/frontend restructure, vision counter and
  live monitor are **not committed yet**.
