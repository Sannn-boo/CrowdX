"""CrowdX visitor counter.

Detects and tracks people (no faces, no images stored) and produces:
  * line crossings (in / out) across a counting line
  * event visitors: unique people who stayed in the event zone >= --min-dwell seconds
    (filters out passers-by walking through the zone)

Usage:
  python count.py --source ../images/Sample01.mp4 --show
  python count.py --source rtsp://user:pass@CAMERA_IP/stream1
"""
import argparse
import csv
import json
import threading
import time
from collections import defaultdict
from pathlib import Path

import cv2
import numpy as np
import requests
import supervision as sv
from ultralytics import YOLO

PERSON_CLASS = 0


class LatestFrameReader:
    """Reads a live stream in a background thread and keeps only the newest frame,
    so slow inference never lets the RTSP buffer lag behind real time."""

    def __init__(self, source):
        self.cap = cv2.VideoCapture(source)
        if not self.cap.isOpened():
            raise RuntimeError(f"Cannot open stream: {source}")
        self.frame = None
        self.ok = True
        self.lock = threading.Lock()
        threading.Thread(target=self._run, daemon=True).start()

    def _run(self):
        while self.ok:
            ok, frame = self.cap.read()
            if not ok:
                time.sleep(0.5)  # camera hiccup: keep trying instead of crashing
                continue
            with self.lock:
                self.frame = frame

    def read(self):
        with self.lock:
            frame, self.frame = self.frame, None
        return frame is not None, frame

    def release(self):
        self.ok = False
        self.cap.release()


def to_pixels(points, w, h):
    return np.array([[int(x * w), int(y * h)] for x, y in points], dtype=np.int32)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="video file, RTSP URL or webcam index")
    ap.add_argument("--model", default="yolo11s.pt")
    ap.add_argument("--imgsz", type=int, default=1280, help="larger finds smaller people, but slower")
    ap.add_argument("--conf", type=float, default=0.3)
    ap.add_argument("--min-dwell", type=float, default=2.0, help="seconds in zone to count as a visitor")
    # Geometry as fractions of frame width/height, so it survives resolution changes.
    # Optional in/out line for a single entrance; off by default because open events are entered from every side.
    ap.add_argument("--line", type=float, nargs=4, metavar=("X1", "Y1", "X2", "Y2"),
                    help="counting line as fractions, e.g. 0 0.55 1 0.55")
    # Default fits Sample01: the booth footprint plus a small margin for people browsing at the edge,
    # excluding the public walkways on both sides (those inflated 29 visitors to 40).
    ap.add_argument("--zone", type=str, default="0.27,0.05 0.72,0.05 0.72,0.81 0.27,0.81",
                    help="event zone polygon: 'x,y x,y ...' as fractions")
    ap.add_argument("--tracker", default=str(Path(__file__).with_name("tracker_crowd.yaml")))
    ap.add_argument("--post-url", help="POST new visitors as {count: n} here, e.g. http://localhost:3000/api/update")
    ap.add_argument("--post-every", type=float, default=5.0, help="seconds between posts")
    ap.add_argument("--frame-url", help="POST annotated JPEG preview frames here, e.g. http://localhost:3000/api/frame")
    ap.add_argument("--frame-every", type=float, default=0.3, help="seconds between preview frames")
    ap.add_argument("--camera-id", default="cam1")
    ap.add_argument("--out", default="output")
    ap.add_argument("--show", action="store_true", help="show a live preview window")
    ap.add_argument("--save-video", action="store_true", help="save annotated video (demo only)")
    ap.add_argument("--loop", action="store_true", help="replay a video file forever (demo only)")
    args = ap.parse_args()

    source = int(args.source) if args.source.isdigit() else args.source
    is_live = isinstance(source, int) or str(source).lower().startswith(("rtsp", "http"))
    reader = LatestFrameReader(source) if is_live else cv2.VideoCapture(source)
    probe = cv2.VideoCapture(source) if not is_live else reader.cap
    fps = probe.get(cv2.CAP_PROP_FPS) or 25
    w, h = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH)), int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))

    model = YOLO(args.model)

    line = None
    if args.line:
        x1, y1, x2, y2 = args.line
        line = sv.LineZone(start=sv.Point(int(x1 * w), int(y1 * h)), end=sv.Point(int(x2 * w), int(y2 * h)),
                           triggering_anchors=(sv.Position.BOTTOM_CENTER,))
    zone_pts = to_pixels([tuple(map(float, p.split(","))) for p in args.zone.split()], w, h)
    zone = sv.PolygonZone(polygon=zone_pts, triggering_anchors=(sv.Position.BOTTOM_CENTER,))

    # Annotators scale with resolution so 4K footage stays readable.
    thick = sv.calculate_optimal_line_thickness((w, h))
    text_scale = sv.calculate_optimal_text_scale((w, h))
    box_ann = sv.BoxAnnotator(thickness=thick)
    label_ann = sv.LabelAnnotator(text_scale=text_scale, text_thickness=thick)
    line_ann = sv.LineZoneAnnotator(thickness=thick, text_scale=text_scale, text_thickness=thick)
    zone_ann = sv.PolygonZoneAnnotator(zone=zone, color=sv.Color.GREEN, thickness=thick,
                                       text_scale=text_scale, text_thickness=thick)

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)
    writer = None
    if args.save_video:
        scale = min(1.0, 1080 / max(w, h))
        out_size = (int(w * scale), int(h * scale))
        writer = cv2.VideoWriter(str(out_dir / f"{args.camera_id}_annotated.mp4"),
                                 cv2.VideoWriter_fourcc(*"mp4v"), fps, out_size)

    # Only anonymous aggregates are stored: track IDs live in memory and are never written out.
    dwell_frames = defaultdict(int)
    visitors = set()
    all_ids = set()
    csv_f = open(out_dir / f"{args.camera_id}_counts.csv", "w", newline="")
    log = csv.writer(csv_f)
    log.writerow(["time_s", "in_view", "in_zone", "line_in", "line_out", "event_visitors"])

    frame_idx, last_logged_s, t0 = 0, -1, time.time()
    posted, last_post = 0, time.time()
    last_frame_post, frame_post_ok = 0.0, True
    try:
        while True:
            ok, frame = reader.read()
            if not ok:
                if is_live:
                    time.sleep(0.01)
                    continue
                if args.loop:  # demo: replay the file (people are counted again on each pass)
                    reader.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break
            frame_idx += 1
            # For live streams use wall-clock time; for files use video time.
            t = time.time() - t0 if is_live else frame_idx / fps

            result = model.track(frame, persist=True, classes=[PERSON_CLASS], imgsz=args.imgsz,
                                 conf=args.conf, tracker=args.tracker, verbose=False)[0]
            det = sv.Detections.from_ultralytics(result)
            if det.tracker_id is None:
                det = det[np.zeros(len(det), dtype=bool)]

            if line:
                line.trigger(det)
            line_in, line_out = (line.in_count, line.out_count) if line else ("", "")
            in_zone = zone.trigger(det)
            frame_dt = (1 / fps) if not is_live else None
            for tid, inside in zip(det.tracker_id if det.tracker_id is not None else [], in_zone):
                all_ids.add(int(tid))
                if inside:
                    dwell_frames[int(tid)] += 1
                    seconds = dwell_frames[int(tid)] * frame_dt if frame_dt else None
                    if seconds is None:  # live: estimate from processed frame rate
                        seconds = dwell_frames[int(tid)] * (t / frame_idx)
                    if seconds >= args.min_dwell:
                        visitors.add(int(tid))

            if int(t) != last_logged_s:
                last_logged_s = int(t)
                log.writerow([last_logged_s, len(det), int(in_zone.sum()), line_in, line_out,
                              len(visitors)])
                csv_f.flush()

            # Send only the increase since the last successful post; on failure keep it for next time.
            if args.post_url and time.time() - last_post >= args.post_every:
                last_post = time.time()
                new_visitors = len(visitors) - posted
                if new_visitors > 0:
                    try:
                        requests.post(args.post_url, json={"count": new_visitors}, timeout=2).raise_for_status()
                        posted += new_visitors
                        print(f"posted +{new_visitors} visitors")
                    except requests.RequestException as e:
                        print(f"post failed, will retry: {e}")

            send_frame = bool(args.frame_url) and time.time() - last_frame_post >= args.frame_every
            if args.show or writer or send_frame:
                labels = [f"#{tid}" + (" V" if tid in visitors else "") for tid in det.tracker_id] \
                    if det.tracker_id is not None else []
                img = zone_ann.annotate(frame.copy())
                img = box_ann.annotate(img, det)
                img = label_ann.annotate(img, det, labels=labels)
                if line:
                    img = line_ann.annotate(img, line_counter=line)
                cv2.putText(img, f"Event visitors: {len(visitors)}", (20, int(60 * text_scale * 2)),
                            cv2.FONT_HERSHEY_SIMPLEX, text_scale * 1.5, (0, 255, 255), thick * 2)
                if writer:
                    writer.write(cv2.resize(img, out_size))
                if send_frame:
                    # Small preview for the dashboard monitor; frames are kept in memory only, never saved.
                    last_frame_post = time.time()
                    scale = min(1.0, 720 / max(w, h))
                    ok_jpg, jpg = cv2.imencode(".jpg", cv2.resize(img, None, fx=scale, fy=scale),
                                               [cv2.IMWRITE_JPEG_QUALITY, 70])
                    try:
                        requests.post(args.frame_url, data=jpg.tobytes(), timeout=1,
                                      headers={"Content-Type": "image/jpeg"}).raise_for_status()
                        frame_post_ok = True
                    except requests.RequestException as e:
                        if frame_post_ok:  # report once, not on every frame
                            print(f"preview frame post failed: {e}")
                        frame_post_ok = False
                if args.show:
                    cv2.imshow("CrowdX", cv2.resize(img, None, fx=0.4, fy=0.4) if max(w, h) > 1920 else img)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break

            if frame_idx % 30 == 0:
                line_txt = f"line in/out={line_in}/{line_out}  " if line else ""
                print(f"t={t:6.1f}s  in_view={len(det):3d}  {line_txt}"
                      f"visitors={len(visitors)}  ({frame_idx / (time.time() - t0):.1f} fps processed)")
    finally:
        if args.post_url and len(visitors) > posted:
            try:
                requests.post(args.post_url, json={"count": len(visitors) - posted}, timeout=2).raise_for_status()
                print(f"posted final +{len(visitors) - posted} visitors")
            except requests.RequestException as e:
                print(f"final post failed: {e}")
        reader.release()
        if writer:
            writer.release()
        csv_f.close()
        cv2.destroyAllWindows()

    summary = {
        "camera_id": args.camera_id,
        "duration_s": round(t, 1) if frame_idx else 0,
        "line_in": line.in_count if line else None,
        "line_out": line.out_count if line else None,
        "event_visitors": len(visitors),
        "unique_tracks_seen": len(all_ids),
        "min_dwell_s": args.min_dwell,
        "processing_fps": round(frame_idx / (time.time() - t0), 2) if frame_idx else 0,
    }
    (out_dir / f"{args.camera_id}_summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
