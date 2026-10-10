# CrowdX: AI Smart Event & Carbon Tracker

```
CrowdX/
├── frontend/
│   └── index.html            Dashboard (Tailwind + Chart.js)
└── backend/
    ├── server.js             Express API (port 3000), also serves the dashboard
    ├── package.json
    └── vision/
        ├── count.py          People counter: YOLO + ByteTrack, no faces stored
        ├── tracker_crowd.yaml
        ├── requirements.txt
        ├── ai_node_legacy.py Old counter (counted every new track ID, so it over-counts)
        ├── samples/          Test videos (not in git, too large)
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

Terminal 1, backend + dashboard:
```
cd backend
npm start
```
Open http://localhost:3000

Terminal 2, vision counter:
```
cd backend\vision
# sample video, looping for a demo
C:\cxenv\Scripts\python.exe count.py --source samples\Sample01.mp4 --loop --post-url http://localhost:3000/api/update --frame-url http://localhost:3000/api/frame
# live CCTV
C:\cxenv\Scripts\python.exe count.py --source rtsp://USER:PASS@CAMERA_IP/stream1 --min-dwell 30 --post-url http://localhost:3000/api/update --frame-url http://localhost:3000/api/frame
```

`--frame-url` sends the annotated preview to the dashboard. To see it, click **System Status**
and look at the Cam 1: Expo Hall card. Preview frames stay in memory and are never saved.

## API

| Method | Path | Body / response |
|---|---|---|
| POST | `/api/update` | `{ "count": <new visitors> }` from the vision counter |
| GET | `/api/data` | current event data for the dashboard |
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
