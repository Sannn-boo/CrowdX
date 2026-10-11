const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// เสิร์ฟหน้า Dashboard จากโฟลเดอร์ frontend → เปิด http://localhost:3000
app.use(express.static(path.join(__dirname, '..', 'frontend')));
// เสิร์ฟวิดีโอตัวอย่างให้หน้าต่าง System Status เล่นได้
app.use('/samples', express.static(path.join(__dirname, 'vision', 'samples')));

// ===== Business Engine: จุดคุ้มทุน (ตาม Break-even_Framework_Mall_Events.pdf) =====
// party: 'mall' = ทาง The Mall กรอก, ไม่ระบุ = ผู้จัดงานกรอก

// ต้นทุนคงที่ (FC) ใช้เหมือนกันทุกประเภทงาน หน่วยบาททั้งงาน
const FIXED_COST_FIELDS = [
    { key: 'venueRental', label: 'Venue rental', party: 'mall' },
    { key: 'electricity', label: 'Electricity', party: 'mall' },
    { key: 'stage', label: 'Stage & production' },
    { key: 'lightingSound', label: 'Lighting & sound' },
    { key: 'decoration', label: 'Decoration' },
    { key: 'marketing', label: 'Marketing' },
    { key: 'staffing', label: 'Core staffing' },
    { key: 'otherFixed', label: 'Other fixed costs' }
];

// แหล่งรายได้ หน่วยบาททั้งงาน (sponsorship: true = นับเป็นเงินสปอนเซอร์)
const REVENUE_FIELDS = {
    tickets: { label: 'Ticket sales' },
    sponsorship: { label: 'Sponsorship', sponsorship: true },
    fnb: { label: 'F&B revenue' },
    merchandise: { label: 'Merchandise' },
    organizerFee: { label: 'Organizer fee' },
    boothFees: { label: 'Booth fees' },
    incrementalMargin: { label: 'Incremental retail margin', party: 'mall' },
    vendorFees: { label: 'Vendor fees' },
    registration: { label: 'Registration fees' },
    b2bSponsorship: { label: 'B2B sponsorship', sponsorship: true },
    entryFees: { label: 'Entry fees' },
    materialSponsorship: { label: 'Material sponsorship', sponsorship: true },
    activityFees: { label: 'Activity fees' },
    esgSponsorship: { label: 'ESG sponsorship', sponsorship: true }
};

// ต้นทุนผันแปร (VC) หน่วยบาทต่อคน
const VARIABLE_COST_FIELDS = {
    security: { label: 'Security' },
    waste: { label: 'Waste handling' },
    giveaways: { label: 'Giveaways' },
    staffing: { label: 'Event staffing' },
    cleaning: { label: 'Cleaning' },
    extraStaffing: { label: 'Extra staffing' },
    electricity: { label: 'Electricity' },
    safety: { label: 'Safety' },
    badges: { label: 'Badges' },
    documents: { label: 'Documents' },
    catering: { label: 'Catering' },
    equipment: { label: 'Equipment' },
    medical: { label: 'Medical support' },
    materials: { label: 'Materials' },
    refreshments: { label: 'Refreshments' },
    toys: { label: 'Toys' },
    safetyStaffing: { label: 'Safety staffing' },
    recycling: { label: 'Waste & recycling' },
    energy: { label: 'Energy' },
    otherVariable: { label: 'Other variable cost' }
};

// แม่แบบตามประเภทงาน (Framework ข้อ 4) ทุกประเภทมีช่อง 'Other variable cost' เพิ่ม
const EVENT_TYPES = {
    concert: { label: 'Concert / Music festival', revenue: ['tickets', 'sponsorship', 'fnb', 'merchandise'], variable: ['security', 'waste', 'giveaways', 'staffing', 'otherVariable'] },
    brandActivation: { label: 'Brand activation / Pop-up', revenue: ['organizerFee', 'boothFees', 'incrementalMargin'], variable: ['giveaways', 'cleaning', 'extraStaffing', 'otherVariable'] },
    foodFestival: { label: 'Food festival', revenue: ['boothFees', 'vendorFees', 'sponsorship'], variable: ['waste', 'cleaning', 'electricity', 'safety', 'otherVariable'] },
    exhibition: { label: 'Exhibition / Convention', revenue: ['registration', 'boothFees', 'b2bSponsorship'], variable: ['badges', 'documents', 'catering', 'otherVariable'] },
    sports: { label: 'Sports / Basketball event', revenue: ['sponsorship', 'entryFees', 'merchandise'], variable: ['equipment', 'medical', 'waste', 'otherVariable'] },
    workshop: { label: 'Workshop / Class', revenue: ['registration', 'materialSponsorship'], variable: ['materials', 'refreshments', 'equipment', 'otherVariable'] },
    family: { label: 'Family / Kids event', revenue: ['sponsorship', 'activityFees', 'fnb'], variable: ['toys', 'giveaways', 'safetyStaffing', 'otherVariable'] },
    green: { label: 'Green / Sustainability event', revenue: ['esgSponsorship', 'registration', 'incrementalMargin'], variable: ['recycling', 'energy', 'otherVariable'] }
};

const RATE_WINDOW_MS = 10 * 60 * 1000; // อัตราคนเข้าเฉลี่ย 10 นาทีล่าสุด
const MIN_FORECAST_MS = 60 * 1000;     // 1 นาทีแรกของงานยังไม่พยากรณ์ (ข้อมูลน้อย ตัวเลขกระโดด)
const SERVER_START = Date.now();

// ===== รายการงาน: แต่ละงานมียอดคน ฟอร์ม Event Setup ประวัติ และกล้องของตัวเอง =====
// เลือกงานด้วย ?event=<id> (ไม่ระบุ = expo) เช่น count.py --post-url http://localhost:3000/api/update?event=lego
const DEFAULT_EVENT = 'expo';
const CAMERA_TIMEOUT_MS = 5000; // กล้อง online ถ้าได้เฟรมภายใน 5 วินาที
const EVENT_INFO = {
    expo: {
        name: 'MUICT x The Mall Green Expo 2026',
        location: 'Bangkapi • MCC Hall',
        camera: 'Cam 1: Expo Hall',
        sample: '/samples/Sample01.mp4',
        // ค่าตั้งต้น = ตัวอย่างข้อ 7 ของ Framework (Brand activation) ต้องได้จุดคุ้มทุน 5,556 คน
        // Framework ให้แค่ยอดรวม FC และ VC จึงใส่ไว้ในช่อง "อื่นๆ"
        config: {
            type: 'brandActivation',
            fixedCost: { otherFixed: 250000 },
            revenue: { organizerFee: 300000, boothFees: 0, incrementalMargin: 60000 },
            variableCost: { otherVariable: 15 },
            expectedVisitors: 6000
        }
    },
    lego: {
        name: 'Family Fun Zone: LEGO Lunar Festival',
        location: 'Bangkhae • Center Court',
        camera: 'Cam 2: Center Court',
        sample: '/samples/Sample02.mp4',
        // ตัวเลขสมมติไว้เดโม (ยังไม่ใช่ข้อมูลจริง) แก้ได้ในฟอร์ม Event Setup → จุดคุ้มทุน 9,000 คน
        config: {
            type: 'family',
            fixedCost: { otherFixed: 180000 },
            revenue: { sponsorship: 150000, activityFees: 90000, fnb: 40000 },
            variableCost: { toys: 10, giveaways: 5, safetyStaffing: 0, otherVariable: 0 },
            expectedVisitors: 8000
        }
    }
};

function createEvent(info) {
    const fixedCost = Object.fromEntries(FIXED_COST_FIELDS.map(f => [f.key, info.config.fixedCost[f.key] || 0]));
    return {
        info,
        // ยอดคนเริ่มที่ 0 แล้วนับจากกล้องจริงเท่านั้น (Carbon ยังเป็นค่าสุ่ม)
        data: {
            totalVisitors: 0,
            carbon: { perVisitor: 0.30, totalCarbon: 2535 },
            travelModes: { mrt: 60, bus: 25, car: 15 }
        },
        config: {
            ...info.config, fixedCost,
            startTime: SERVER_START,
            endTime: SERVER_START + 2 * 60 * 60 * 1000,
            surplusPct: 10
        },
        // ประวัติยอดคนสะสม (เวลา, ยอดรวม) ใช้คิดอัตราคนเข้าและวาดกราฟ เก็บเฉพาะตัวเลขรวม
        history: [{ t: SERVER_START, n: 0 }],
        // เฟรมล่าสุดจากกล้อง เก็บในหน่วยความจำเท่านั้น ไม่บันทึกลงดิสก์
        frame: null,
        frameAt: 0
    };
}

const events = Object.fromEntries(Object.entries(EVENT_INFO).map(([id, info]) => [id, createEvent(info)]));

// หางานจาก ?event= ถ้าไม่เจอตอบ 404
function findEvent(req, res) {
    const id = req.query.event || DEFAULT_EVENT;
    const ev = events[id];
    if (!ev) res.status(404).json({ success: false, error: `Unknown event: ${id}` });
    return ev;
}

// ยอดคนสะสม ณ เวลา t (ใช้จุดล่าสุดที่ไม่เกิน t)
function visitorsAt(ev, t) {
    let n = 0;
    for (const h of ev.history) {
        if (h.t > t) break;
        n = h.n;
    }
    return n;
}

function sumFields(keys, values) {
    return keys.reduce((s, k) => s + (values[k] || 0), 0);
}

function computeBusiness(ev, now = Date.now()) {
    const c = ev.config;
    const type = EVENT_TYPES[c.type];
    const n = ev.data.totalVisitors;

    const fc = sumFields(FIXED_COST_FIELDS.map(f => f.key), c.fixedCost);
    const vc = sumFields(type.variable, c.variableCost);
    const sponsorship = sumFields(type.revenue.filter(k => REVENUE_FIELDS[k].sponsorship), c.revenue);
    // R = รายได้รวม ÷ จำนวนคนที่คาดไว้ (ล็อกค่าก่อนงาน ตาม Framework ข้อ 7)
    const r = sumFields(type.revenue, c.revenue) / c.expectedVisitors;

    // N_break-even = FC ÷ (R − VC) ปัดขึ้น (ปัดทศนิยมก่อนกันค่าคลาดเคลื่อนของ float)
    const breakEven = r > vc ? Math.ceil(Math.round(fc / (r - vc) * 1e6) / 1e6) : null;

    // อัตราคนเข้าเฉลี่ยช่วง 10 นาทีล่าสุด (ถ้างานเพิ่งเริ่ม ใช้เวลาที่ผ่านไปจริง)
    const windowStart = Math.max(now - RATE_WINDOW_MS, c.startTime);
    const ratePerMs = now > windowStart ? (n - visitorsAt(ev, windowStart)) / (now - windowStart) : 0;
    const remainingMs = Math.max(0, c.endTime - now);
    // N_forecast_end = N_now + อัตรา × เวลาที่เหลือ (Framework ข้อ 5)
    const collecting = now - c.startTime < MIN_FORECAST_MS;
    const projected = collecting ? null : Math.round(n + ratePerMs * remainingMs);

    let status;
    if (breakEven === null) status = 'No Break-even';
    else if (collecting) status = 'Collecting data';
    else if (projected >= breakEven * (1 + c.surplusPct / 100)) status = 'Surplus';
    else if (projected >= breakEven) status = 'On Track';
    else status = 'At Risk';

    const needed = breakEven === null ? null : Math.max(0, breakEven - n);
    const costPerAttendee = n > 0 ? (fc + vc * n) / n : null;

    return {
        fixedCost: fc,
        variableCostPerAttendee: vc,
        revenuePerAttendee: r,
        breakEven,
        visitors: n,
        progressPct: breakEven === null ? null : (breakEven === 0 ? 100 : n / breakEven * 100),
        visitorsNeeded: needed,
        ratePerHour: ratePerMs * 3600000,
        projectedVisitors: projected,
        status,
        costPerAttendee,
        netValuePerAttendee: costPerAttendee === null ? null : r - costPerAttendee,
        projectedProfit: collecting ? null : (r - vc) * projected - fc,
        sponsorshipPerAttendee: n > 0 ? sponsorship / n : null,
        minutesToBreakEven: needed === null ? null : (needed === 0 ? 0 : (!collecting && ratePerMs > 0 ? needed / ratePerMs / 60000 : null)),
        remainingMinutes: remainingMs / 60000
    };
}

// ลดจำนวนจุดในกราฟให้เหลือไม่เกิน max จุด (เก็บจุดล่าสุดไว้เสมอ)
function sampledHistory(ev, max = 60) {
    const h = ev.history;
    if (h.length <= max) return h;
    const step = (h.length - 1) / (max - 1);
    return Array.from({ length: max }, (_, i) => h[Math.round(i * step)]);
}

// ตรวจค่าเงิน: ต้องเป็นตัวเลข ≥ 0 ช่องที่ไม่ส่งมาถือเป็น 0
function pickAmounts(keys, src) {
    const out = {};
    for (const k of keys) {
        const v = src && src[k] !== undefined ? src[k] : 0;
        if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return null;
        out[k] = v;
    }
    return out;
}

// รับข้อมูลจาก Python AI
app.post('/api/update', (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    const detectedPeople = req.body.count;
    const eventData = ev.data;

    if (detectedPeople) {
        // 1. อัปเดตยอดคน
        eventData.totalVisitors += detectedPeople;
        ev.history.push({ t: Date.now(), n: eventData.totalVisitors });

        // 2. คำนวณ Carbon ใหม่ให้แกว่งสมจริง
        const randomFluctuation = (Math.random() * 0.02) - 0.01;
        eventData.carbon.perVisitor = parseFloat((0.30 + randomFluctuation).toFixed(2));

        // 3. สุ่มปรับสัดส่วนการเดินทางให้กราฟวงกลมขยับ (รวมกันต้องได้ 100%)
        eventData.travelModes.mrt = 55 + Math.floor(Math.random() * 10);
        eventData.travelModes.bus = 20 + Math.floor(Math.random() * 10);
        eventData.travelModes.car = 100 - eventData.travelModes.mrt - eventData.travelModes.bus;

        console.log(`[AI] ${ev.info.name} อัปเดตคน: ${eventData.totalVisitors} | Carbon/Pax: ${eventData.carbon.perVisitor}`);
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false });
    }
});

const cameraOnline = ev => Date.now() - ev.frameAt < CAMERA_TIMEOUT_MS;

// รายการงานทั้งหมด สำหรับการ์ดในหน้า Hub
app.get('/api/events', (req, res) => {
    res.json(Object.entries(events).map(([id, ev]) => ({
        id, ...ev.info, config: undefined,
        totalVisitors: ev.data.totalVisitors,
        carbon: ev.data.carbon,
        business: computeBusiness(ev),
        cameraOnline: cameraOnline(ev)
    })));
});

// ส่งข้อมูลให้ Frontend
app.get('/api/data', (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    res.json({ ...ev.data, business: computeBusiness(ev), history: sampledHistory(ev) });
});

// ข้อมูลตั้งค่างาน + แม่แบบฟอร์มตามประเภทงาน
app.get('/api/event', (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    res.json({
        info: { ...ev.info, config: undefined },
        config: ev.config,
        templates: { fixedCost: FIXED_COST_FIELDS, revenue: REVENUE_FIELDS, variableCost: VARIABLE_COST_FIELDS, eventTypes: EVENT_TYPES }
    });
});

// บันทึกฟอร์ม Event Setup (เก็บในหน่วยความจำ รีสตาร์ทแล้วกลับเป็นค่าตั้งต้น)
app.post('/api/event', (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    const b = req.body || {};
    const type = EVENT_TYPES[b.type];
    if (!type) return res.status(400).json({ success: false, error: 'Unknown event type' });

    const fixedCost = pickAmounts(FIXED_COST_FIELDS.map(f => f.key), b.fixedCost);
    const revenue = pickAmounts(type.revenue, b.revenue);
    const variableCost = pickAmounts(type.variable, b.variableCost);
    if (!fixedCost || !revenue || !variableCost) {
        return res.status(400).json({ success: false, error: 'Amounts must be numbers ≥ 0' });
    }
    if (!(b.expectedVisitors > 0)) {
        return res.status(400).json({ success: false, error: 'Expected visitors must be greater than 0' });
    }
    if (!Number.isFinite(b.startTime) || !Number.isFinite(b.endTime) || b.endTime <= b.startTime) {
        return res.status(400).json({ success: false, error: 'End time must be after start time' });
    }
    if (!(b.surplusPct >= 0)) {
        return res.status(400).json({ success: false, error: 'Surplus threshold must be ≥ 0' });
    }

    ev.config = {
        type: b.type, fixedCost, revenue, variableCost,
        expectedVisitors: b.expectedVisitors, startTime: b.startTime, endTime: b.endTime, surplusPct: b.surplusPct
    };
    console.log(`[Event] ${ev.info.name} ตั้งค่างานใหม่: ${type.label} | จุดคุ้มทุน ${computeBusiness(ev).breakEven}`);
    res.json({ success: true, config: ev.config });
});

// ===== Live Monitor: กล้องละงาน (?event=) =====
// เก็บเฉพาะเฟรมล่าสุดในหน่วยความจำ ไม่บันทึกลงดิสก์

// รับภาพ JPEG จาก Python AI
app.post('/api/frame', express.raw({ type: 'image/jpeg', limit: '5mb' }), (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    if (!req.body || !req.body.length) return res.status(400).json({ success: false });
    ev.frame = req.body;
    ev.frameAt = Date.now();
    res.json({ success: true });
});

// สถานะกล้อง: online ถ้าได้รับเฟรมภายใน 5 วินาที
app.get('/api/camera', (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    res.json({ online: cameraOnline(ev), lastFrameAt: ev.frameAt || null });
});

// สตรีม MJPEG ให้แท็ก <img> แสดงผลได้โดยตรง
app.get('/api/stream', (req, res) => {
    const ev = findEvent(req, res);
    if (!ev) return;
    res.writeHead(200, {
        'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
        'Cache-Control': 'no-cache, no-store',
        'Connection': 'close'
    });
    let sentAt = 0;
    const timer = setInterval(() => {
        if (!ev.frame || ev.frameAt === sentAt) return;
        sentAt = ev.frameAt;
        res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${ev.frame.length}\r\n\r\n`);
        res.write(ev.frame);
        res.write('\r\n');
    }, 100);
    req.on('close', () => clearInterval(timer));
});

app.listen(3000, () => console.log(`🚀 CrowdX Backend Running on port 3000`));