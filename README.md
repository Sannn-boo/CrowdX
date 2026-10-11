# CrowdX: AI Smart Event & Carbon Tracker

```
CrowdX/
├── frontend/
│   ├── index.html            Event hub (homepage): all events, links to each dashboard
│   ├── event.html            Event dashboard: event.html?event=<id> (Tailwind + Chart.js)
│   ├── theme.css             Shared look for both pages (font, cards, top bar, tabs, inputs)
│   ├── assets/               CrowdX logo (original) + crowdx-mark.png / crowdx-favicon.png cut from it
│   └── vendor/               Tailwind, Chart.js, html2pdf, Inter font saved locally so demos work offline
└── backend/
    ├── server.js             Express API (port 3000), also serves the dashboard
    ├── package.json
    └── vision/
        ├── count.py          People counter: YOLO + ByteTrack, no faces stored
        ├── tracker_crowd.yaml
        ├── requirements.txt
        ├── ai_node_legacy.py Old counter (counted every new track ID, so it over-counts)
        ├── samples/          Test videos: Sample01 (expo), Sample02 (lego)
        └── output/           Count logs + demo_annotated.mp4 backup (not in git)
```

## Setup (first time)

```
cd backend
npm install

# Python: use a venv at a short path. The Microsoft Store Python hits the
# Windows path-length limit when installing torch.
python -m venv C:\cxenv
C:\cxenv\Scripts\python.exe -m pip install -r vision\requirements.txt
```

## Run

Run one counter per event, each in its own terminal. Each counter sends its visitors and camera
preview to one event, chosen by `?event=<id>` in its URLs (no `?event=` means `expo`).

**Terminal 1: backend + dashboard**
```
cd backend
node server.js
```
Open http://localhost:3000. Restart the backend after any change to `server.js`, otherwise new
features such as `?event=lego` aren't there yet.

**Terminal 2: Event 1, MUICT x The Mall Green Expo (`expo`, Sample01)**
```
cd backend\vision
C:\cxenv\Scripts\python.exe count.py --source samples\Sample01.mp4 --post-url http://localhost:3000/api/update --frame-url http://localhost:3000/api/frame
```

**Terminal 3: Event 2, Family Fun Zone: LEGO Lunar Festival (`lego`, Sample02)**
```
cd backend\vision
C:\cxenv\Scripts\python.exe count.py --source samples\Sample02.mp4 --imgsz 1920 --camera-id lego --zone "0.20,0.32 0.40,0.24 0.45,0.12 0.63,0.13 0.73,0.28 0.86,0.44 0.87,0.68 0.75,0.81 0.63,0.95 0.27,0.95 0.19,0.80" --post-url "http://localhost:3000/api/update?event=lego" --frame-url "http://localhost:3000/api/frame?event=lego"
```
- Keep the quotes around URLs with `?event=`. Without them, PowerShell can misread the `?`.
- People are smaller in Sample02, so it needs `--imgsz 1920` (1280 misses most of them). That makes
  it slower, about 1–1.5 fps on CPU.
- The zone is drawn around the LEGO exhibit for this video only.

**Live CCTV instead of a sample:** use the RTSP URL as `--source`, a longer dwell, and the event's URLs:
```
C:\cxenv\Scripts\python.exe count.py --source rtsp://USER:PASS@CAMERA_IP/stream1 --min-dwell 30 --post-url "http://localhost:3000/api/update?event=expo" --frame-url "http://localhost:3000/api/frame?event=expo"
```

Notes:
- Sample videos play once. `--loop` replays them but counts the same people again on every pass,
  so the count isn't real (demo only).
- The dashboard total keeps adding up across counter runs until the backend restarts. For a clean
  demo, restart `node server.js` and then run each counter once.
- `--frame-url` sends the annotated preview to the dashboard. To see it, open the event and click
  **Camera**. Preview frames stay in memory and are never saved.

## Events

The backend keeps a separate visitor count, Event Setup, history and camera for each event, defined
in `EVENT_INFO` in `server.js`. Pick the event with `?event=<id>` on any API call and on the dashboard
(`event.html?event=lego`). Without it, the default is `expo`.

| id | Event | Camera / sample | Event type (default setup) |
|---|---|---|---|
| `expo` | MUICT x The Mall Green Expo 2026 | Cam 1, `Sample01.mp4` | Brand activation (framework example, break-even 5,556) |
| `lego` | Family Fun Zone: LEGO Lunar Festival | Cam 2, `Sample02.mp4` | Family / Kids (made-up demo numbers, break-even 9,000) |

## API

All paths except `/api/events` take `?event=<id>` (default `expo`); an unknown id returns 404.

| Method | Path | Body / response |
|---|---|---|
| GET | `/api/events` | every event with name, location, camera, visitor count, `business` and `cameraOnline`, for the hub |
| POST | `/api/update` | `{ "count": <new visitors> }` from the vision counter |
| GET | `/api/data` | current event data for the dashboard, including `business` (break-even metrics) and `history` (visitor count over time) |
| GET | `/api/event` | `{ info, config, templates }`: event name/location/camera/sample video, event setup, and the form fields for each event type |
| POST | `/api/event` | save event setup (type, costs, revenue, expected visitors, start/end time, surplus %); kept in memory only |
| POST | `/api/frame` | JPEG preview frame (`Content-Type: image/jpeg`) from the vision counter |
| GET | `/api/camera` | `{ online, lastFrameAt }`: online if a frame arrived in the last 5 s |
| GET | `/api/stream` | MJPEG live stream of the latest frames |

## How visitors are counted

A person counts as an event visitor when their tracked position stays inside the event zone
(`--zone`) for at least `--min-dwell` seconds. Passers-by aren't counted. Only aggregate counts
are stored: no faces, no images, no IDs. Run `python count.py --help` for all options.

Set the zone and line for each camera. They are fractions (0–1) of the frame, and the defaults
fit `Sample01.mp4` only. Draw the zone tightly around the event footprint (booths plus a small
margin for people browsing at the edge), not the walkways around it, or passers-by get counted.
For an open event that people enter from every side, the zone + dwell count is the visitor
number. The counting line (`--line`) is off by default; pass it only to get in/out counts across a
single entrance.

`--imgsz` has to suit how big people look in the video. On Sample02 (people small in the frame),
1280 found 16 of about 60 people in a frame and 1920 found 52. Bigger is slower on CPU.

Results on the samples (2 s dwell, **not yet checked against a hand count**):

| Sample | Event visitors | Track IDs created | Note |
|---|---|---|---|
| Sample01 (expo) | 29 | 67 | about 35 people in view |
| Sample02 (lego), `--imgsz 1920` | 64 | 143 | about 40 people detected at a time, so some people are probably counted twice after an ID switch |

Booth staff and children inside the zone count as visitors too.

## How break-even is calculated

Follows `Break-even_Framework_Mall_Events.pdf`. Enter costs and revenue in **Business > Event Setup**
(The Mall's fields on the left, the organizer's on the right; the fields change with the event type).

- R (revenue per visitor) = total revenue ÷ expected visitors, fixed when the setup is saved
- Break-even visitors = FC ÷ (R − VC), rounded up. If R ≤ VC the event can't break even.
- Projected visitors = current count + pace over the last 10 minutes × time left until the event ends
- Status: At Risk (projected below break-even), On Track, or Surplus (projected ≥ break-even + surplus %).
  During the first minute after the event start it shows "Collecting data" and doesn't forecast yet.

Defaults: `expo` uses the worked example in section 7 of the framework (break-even 5,556 visitors);
`lego` uses made-up demo numbers for a Family / Kids event (break-even 9,000). The visitor count
starts at 0 and comes only from the vision counter. Setup and history are kept in memory per event,
so restarting the server resets them.

## How carbon is calculated (work in progress)

The **Carbon** page computes Scope 1/2/3 from the form (electricity, diesel, materials, meals,
waste, water, staff and contractor travel) with emission factors labelled TGO in `event.html`
(`EF`). The live visitor count fills the visitor field.

- **Emission factor sources aren't cited yet.** Each value needs to be checked against TGO's
  published tables, with the table name and year shown in the report.
- **Visitor travel is an assumption:** every visitor is counted as a 20 km round trip by car. Cameras
  can't see how people travelled; real travel modes should come from a visitor survey.
- **The 0.40 kgCO2e/pax Green Event threshold is a CrowdX draft**, proposed for The Mall Group's Go to
  Zero, not an official certification. The page and report say "Meets Draft Threshold", not "Certified".
- **Known problem:** the car assumption alone is 20 km × 0.17 = 3.40 kgCO2e per visitor, so no event
  can meet the 0.40 threshold. Either the threshold or the travel assumption needs a sourced revision.

## What's real on the dashboard

| Number | Source |
|---|---|
| Visitor count, live camera, break-even, forecast, cost per visitor | Real: camera count + Event Setup form |
| Carbon per visitor on the event dashboard | Calculated from the Carbon form (see the caveats above) |
| Carbon per pax on the hub, and the `carbon` / `travelModes` fields in `/api/data` | **Random placeholder** from `server.js`; doesn't match the dashboard |
| Spillover lift (+10.4% etc.) | **Illustrative**, typed into the HTML and labelled so on the page |
| Upcoming events (Sneaker Fest, Foodie Market) | Example cards, no data |
