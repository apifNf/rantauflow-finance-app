const express = require("express");
const cors = require("cors");
const path = require('path');
const bcrypt = require("bcrypt");
const midtransClient = require("midtrans-client");
const nodemailer = require("nodemailer");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ================= SETUP EMAIL (OTP) =================
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'emailkamu@gmail.com',
    pass: process.env.EMAIL_PASS || 'passwordaplikasi'
  }
});

// ================= SETUP MIDTRANS =================
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || 'RAHASIA_DI_HOSTINGER',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || 'RAHASIA_DI_HOSTINGER'
});

// ================= DATABASE INIT (LANGSUNG NYALA) =================
const sqlite3 = require("sqlite3").verbose();
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error("Gagal memuat file database:", err.message);
    } else {
        console.log("Database SQLite terhubung dan siap digunakan.");
        db.serialize(() => {
            db.run(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE, password TEXT, is_pro INTEGER DEFAULT 0)`);
            db.run(`CREATE TABLE IF NOT EXISTS transactions(id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, amount INTEGER, type TEXT, category TEXT, wallet TEXT DEFAULT 'utama', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
            db.run(`ALTER TABLE users ADD COLUMN is_pro INTEGER DEFAULT 0`, (err) => {});
            db.run(`ALTER TABLE transactions ADD COLUMN wallet TEXT DEFAULT 'utama'`, (err) => {});
        });
    }
});

// ================= KOSAKATA AI (TRADING & FINANCE) =================
function parseMessage(text) {
  text = (text || "").toLowerCase();
  let amount = 0; let category = "other"; let type = "expense";

  const match = text.match(/(\$)?(\d+)\s?(k|jt)?\b/i);
  if (match) {
    const isDollar = match[1] === "$"; amount = parseInt(match[2]);
    if (match[3] === "k") amount *= 1000;
    if (match[3] === "jt") amount *= 1000000;
    if (isDollar) amount *= 16300; 
  }

  if (text.includes("profit") || text.includes("cuan") || text.includes("gain") || text.includes("wd")) { type = "income"; category = "investment"; } 
  else if (text.includes("rugi") || text.includes("loss") || text.includes("cutloss") || text.includes("boncos") || text.includes("liquid")) { type = "expense"; category = "investment"; } 
  else if (text.includes("crypto") || text.includes("forex") || text.includes("saham") || text.includes("invest") || text.includes("beli koin")) { type = "expense"; category = "investment"; } 
  else if (text.includes("tabung") || text.includes("nabung") || text.includes("save")) { type = "saving"; category = "saving"; } 
  else if (text.includes("gaji") || text.includes("bonus") || text.includes("masuk")) { type = "income"; category = "salary"; } 
  else if (text.includes("uang makan") || text.includes("meal allowance")) { type = "income"; category = "allowance"; } 
  else if (text.includes("party") || text.includes("club") || text.includes("nongkrong") || text.includes("bar")) { type = "expense"; category = "lifestyle"; } 
  else if (text.includes("grab") || text.includes("taxi")) { type = "expense"; category = "transport"; } 
  else if (text.includes("makan") || text.includes("kopi")) { category = "food"; }
  return { amount, type, category };
}

// ================= ENDPOINT API =================

app.get("/", (req, res) => { res.send("RantauFlow API Running Perfectly"); });

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, message: "Data tidak lengkap" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users(email, password, is_pro) VALUES(?, ?, 0)", [email, hashedPassword], function (err) {
      if (err) return res.json({ success: false, message: "Error DB: " + err.message });
      res.json({ success: true, userId: this.lastID, isPro: 0 });
    });
  } catch (err) { res.json({ success: false, message: "Server error" }); }
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
    if (err || !row) return res.json({ success: false, message: "Email tidak ditemukan atau salah" });
    try {
      const match = await bcrypt.compare(password, row.password);
      if (match) res.json({ success: true, userId: row.id, isPro: row.is_pro });
      else res.json({ success: false, message: "Password salah" });
    } catch (err) { res.json({ success: false }); }
  });
});

app.post("/forgot-password", (req, res) => {
    const { email } = req.body;
    db.get("SELECT id FROM users WHERE email = ?", [email], (err, row) => {
        if (!row) return res.json({ success: false, message: "Email tidak terdaftar" });
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        app.locals[email] = { otp: otpCode, expired: Date.now() + (15 * 60000) }; 
        const mailOptions = { from: 'RantauFlow Security', to: email, subject: 'Kode Reset Password RantauFlow', text: `Kode OTP Anda adalah: ${otpCode}. Kode ini berlaku selama 15 menit.` };
        transporter.sendMail(mailOptions, (error, info) => {
            if (error) return res.json({ success: false, message: "Gagal mengirim email OTP. Pastikan setting Email di Hostinger benar." });
            res.json({ success: true, message: "OTP Terkirim!" });
        });
    });
});

app.post("/reset-password", async (req, res) => {
    const { email, otp, newPassword } = req.body;
    const session = app.locals[email];
    if (!session || session.otp !== otp) return res.json({ success: false, message: "OTP Salah atau Expired!" });
    if (Date.now() > session.expired) return res.json({ success: false, message: "OTP Kadaluarsa!" });

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        db.run("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email], (err) => {
            if (err) return res.json({ success: false, message: "Gagal update password" });
            delete app.locals[email]; 
            res.json({ success: true, message: "Password berhasil diubah" });
        });
    } catch (error) { res.json({ success: false, message: "Server error" }); }
});

app.post("/api/checkout", async (req, res) => {
  const { userId } = req.body;
  db.get("SELECT email FROM users WHERE id = ?", [userId], async (err, row) => {
    if (err || !row) return res.status(500).json({ success: false, message: "User tidak ditemukan" });
    const parameter = {
      transaction_details: { order_id: `RF-PRO-${userId}-${Date.now()}`, gross_amount: 9900 },
      customer_details: { email: row.email },
      item_details: [{ id: "PRO-1", price: 9900, quantity: 1, name: "RantauFlow PRO (1 Bulan)" }]
    };
    try {
      const transaction = await snap.createTransaction(parameter);
      res.json({ success: true, token: transaction.token });
    } catch (error) { res.status(500).json({ success: false, message: "Gagal membuat link pembayaran" }); }
  });
});

app.post("/api/payment-notification", async (req, res) => {
  try {
    const statusResponse = await snap.transaction.notification(req.body);
    const orderId = statusResponse.order_id;
    const userId = orderId.split('-')[2];
    if ((statusResponse.transaction_status === 'capture' || statusResponse.transaction_status === 'settlement') && (statusResponse.fraud_status === 'accept' || !statusResponse.fraud_status)) {
      db.run("UPDATE users SET is_pro = 1 WHERE id = ?", [userId]);
    }
    res.status(200).send("OK");
  } catch (error) { res.status(500).send("Server Error"); }
});

app.post("/chat", (req, res) => {
  const { message, wallet, userId } = req.body;
  if (!userId) return res.json({ message: "User belum login" });
  const parsed = parseMessage(message);
  if (!parsed.amount) return res.json({ message: "Gue ga ngerti nominalnya bro 😅" });
  if (parsed.category === "allowance") return res.json({ message: `🍜 Tunjangan/Uang makan masuk sebesar Rp${parsed.amount.toLocaleString("id-ID")}` });
  const dompetDipakai = wallet || 'utama';
  db.run("INSERT INTO transactions(user_id, amount, type, category, wallet) VALUES(?, ?, ?, ?, ?)", [userId, parsed.amount, parsed.type, parsed.category, dompetDipakai], function (err) {
      if (err) return res.json({ message: "Error simpan data" });
      res.json({ message: `Tercatat pos *${parsed.category}* sebesar Rp${parsed.amount.toLocaleString("id-ID")} memakai Dompet [${dompetDipakai}].` });
  });
});

app.post("/chat-ai", (req, res) => {
  const { message, userId } = req.body;
  if (!userId) return res.json({ reply: "Login dulu bro." });
  db.all("SELECT * FROM transactions WHERE user_id = ?", [userId], (err, rows) => {
    let income = 0; let expense = 0;
    rows.forEach(tx => { if (tx.type === "income") income += tx.amount; if (tx.type === "expense") expense += tx.amount; });
    const balance = income - expense;
    if (message.toLowerCase().includes("roast")) return res.json({ reply: "💀 Dompet lu kerja rodi buat nongkrong." });
    if (balance < 0) return res.json({ reply: `💀 Lu nombok hidup.\n\nEvaluasi kilat:\n• Pangkas lifestyle` });
    res.json({ reply: '🔥 Cashflow aman terkendali. Lanjutkan bro!' });
  });
});

app.get('/summary', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ error: "Unauthorized" });
  db.all('SELECT * FROM transactions WHERE user_id = ?', [userId], (err, rows) => {
    if (err) return res.json({ error: err.message });
    let income = 0; let expense = 0;
    rows.forEach(tx => { if (tx.type === "income") income += tx.amount; if (tx.type === "expense") expense += tx.amount; });
    res.json({ transactions: rows, income, expense, balance: (income - expense), healthScore: 100, recurring: [], recent: [], weeklySpend: 0 });
  });
});

app.get("/insight", (req, res) => {
  const userId = req.query.userId;
  db.get(`SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM transactions WHERE user_id=?`, [userId], (err, row) => {
    const income = row?.income || 0; const expense = row?.expense || 0;
    res.json({ income, expense, balance: (income - expense), insight: ["✅ Stabil"] });
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SUKSES] Server RantauFlow berhasil buka gerbang di port ${PORT}`);
});