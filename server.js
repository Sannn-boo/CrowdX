const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

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

app.listen(3000, () => console.log(`🚀 CrowdX Backend Running on port 3000`));