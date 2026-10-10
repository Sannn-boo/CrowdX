const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// เสิร์ฟหน้า Dashboard จากโฟลเดอร์ frontend → เปิด http://localhost:3000
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ข้อมูลเริ่มต้น (ลบ Dwell Time และ Lead Rate ออกแล้ว)
let eventData = {
    totalVisitors: 8450,
    business: { netValue: 45.50, cost: 17.75 },
    carbon: { perVisitor: 0.30, totalCarbon: 2535 },
    travelModes: { mrt: 60, bus: 25, car: 15 }
};

// รับข้อมูลจาก Python AI
app.post('/api/update', (req, res) => {
    const detectedPeople = req.body.count;

    if (detectedPeople) {
        // 1. อัปเดตยอดคน
        eventData.totalVisitors += detectedPeople;

        // 2. คำนวณ Carbon ใหม่ให้แกว่งสมจริง
        const randomFluctuation = (Math.random() * 0.02) - 0.01; 
        eventData.carbon.perVisitor = parseFloat((0.30 + randomFluctuation).toFixed(2));

        // 3. สุ่มปรับสัดส่วนการเดินทางให้กราฟวงกลมขยับ (รวมกันต้องได้ 100%)
        eventData.travelModes.mrt = 55 + Math.floor(Math.random() * 10);
        eventData.travelModes.bus = 20 + Math.floor(Math.random() * 10);
        eventData.travelModes.car = 100 - eventData.travelModes.mrt - eventData.travelModes.bus;

        console.log(`[AI] อัปเดตคน: ${eventData.totalVisitors} | Carbon/Pax: ${eventData.carbon.perVisitor}`);
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false });
    }
});

// ส่งข้อมูลให้ Frontend
app.get('/api/data', (req, res) => {
    res.json(eventData);
});

// ===== Live Monitor (Cam 1: Expo Hall) =====
// เก็บเฉพาะเฟรมล่าสุดในหน่วยความจำ ไม่บันทึกลงดิสก์
let latestFrame = null;
let latestFrameAt = 0;
const CAMERA_TIMEOUT_MS = 5000;

// รับภาพ JPEG จาก Python AI
app.post('/api/frame', express.raw({ type: 'image/jpeg', limit: '5mb' }), (req, res) => {
    if (!req.body || !req.body.length) return res.status(400).json({ success: false });
    latestFrame = req.body;
    latestFrameAt = Date.now();
    res.json({ success: true });
});

// สถานะกล้อง: online ถ้าได้รับเฟรมภายใน 5 วินาที
app.get('/api/camera', (req, res) => {
    res.json({ online: Date.now() - latestFrameAt < CAMERA_TIMEOUT_MS, lastFrameAt: latestFrameAt || null });
});

// สตรีม MJPEG ให้แท็ก <img> แสดงผลได้โดยตรง
app.get('/api/stream', (req, res) => {
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'close'
    });
    let sentAt = 0;
    const timer = setInterval(() => {
        if (!latestFrame || latestFrameAt === sentAt) return;
        sentAt = latestFrameAt;
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${latestFrame.length}\r\n\r\n`);
        res.write(latestFrame);
        res.write('\r\n');
    }, 100);
    req.on('close', () => clearInterval(timer));
});

app.listen(3000, () => console.log(`🚀 CrowdX Backend Running on port 3000`));