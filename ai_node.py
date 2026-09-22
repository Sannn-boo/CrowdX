import cv2
from ultralytics import YOLO
import requests
import time

model = YOLO('yolov8n.pt')
# เปลี่ยนชื่อไฟล์วิดีโอตรงนี้ถ้ามี footage
cap = cv2.VideoCapture('mall_traffic.mp4') 

print("Starting CrowdX Vision AI with Advanced Tracking...")
last_send_time = time.time()

# ตัวแปรใหม่สำหรับจำ ID คนที่ถูกนับไปแล้ว จะได้ไม่นับซ้ำ
counted_ids = set()
new_people_to_send = 0

while cap.isOpened():
    success, frame = cap.read()
    if not success:
        break

    # อัปเกรด: ใช้ .track() แทนการใช้โมเดลธรรมดา เพื่อให้ AI จำ ID คนได้
    results = model.track(frame, classes=[0], persist=True, verbose=False)
    
    # ตรวจสอบว่ามีคนในเฟรมและได้รับ ID หรือไม่
    if results[0].boxes.id is not None:
        track_ids = results[0].boxes.id.int().cpu().tolist()
        
        for track_id in track_ids:
            # ถ้าเป็นคนใหม่ที่ยังไม่เคยนับ
            if track_id not in counted_ids:
                counted_ids.add(track_id)
                new_people_to_send += 1 # ทดเอาไว้เตรียมส่งให้เว็บ

    annotated_frame = results[0].plot()
    cv2.imshow("CrowdX Advanced AI", annotated_frame)

    current_time = time.time()
    if current_time - last_send_time >= 5:
        # ส่งข้อมูลก็ต่อเมื่อมี "คนใหม่" เดินเข้ามาจริงๆ เท่านั้น
        if new_people_to_send > 0:
            try:
                url = "http://localhost:3000/api/update"
                requests.post(url, json={"count": new_people_to_send})
                print(f"Data synced: +{new_people_to_send} new unique visitor(s).")
                new_people_to_send = 0 # รีเซ็ตค่าหลังจากส่งเสร็จ
            except:
                print("Awaiting connection to Dashboard server...")
        
        last_send_time = current_time

    if cv2.waitKey(1) & 0xFF == ord('q'):
        break

cap.release()
cv2.destroyAllWindows()