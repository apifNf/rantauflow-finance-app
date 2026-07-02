const express = require("express");
const cors = require("cors");
const path = require('path');
const bcrypt = require("bcrypt");
const midtransClient = require("midtrans-client");
const nodemailer = require("nodemailer");
const mysql = require("mysql2");

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

// ================= FASE 1: BUKA PINTU SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SUKSES] Server RantauFlow Enterprise hidup di port ${PORT}`);
});

// ================= FASE 2: DATABASE CONNECTION POOLING (MYSQL) =================
// Sistem Pool ini mencegah server down meski ada 1000 user menekan tombol bersamaan
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rantauflow_db',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

// Tes Koneksi & Buat Tabel Otomatis
pool.getConnection((err, connection) => {
    if (err) {
        console.error("[CRITICAL ERROR] Gagal nyambung ke MySQL:", err.message);
    } else {
        console.log("[SUKSES] Database MySQL Enterprise Terhubung! Siap scale-up.");
        
        const createUsers = `CREATE TABLE IF NOT EXISTS users(
            id INT AUTO_INCREMENT PRIMARY KEY, 
            email VARCHAR(255) UNIQUE, 
            password VARCHAR(255), 
            is_pro TINYINT DEFAULT 0
        )`;
        
        const createTransactions = `CREATE TABLE IF NOT EXISTS transactions(
            id INT AUTO_INCREMENT PRIMARY KEY, 
            user_id INT, 
            amount BIGINT, 
            type VARCHAR(50), 
            category VARCHAR(50), 
            wallet VARCHAR(100) DEFAULT 'utama', 
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`;

        connection.query(createUsers);
        connection.query(createTransactions);
        connection.release();
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

// ================= ENDPOINT API MYSQL =================
app.get("/", (req, res) => { res.send("RantauFlow Enterprise API Running Perfectly"); });

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, message: "Data tidak lengkap" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    pool.query("INSERT INTO users(email, password, is_pro) VALUES(?, ?, 0)", [email, hashedPassword], (err, result) => {
      if (err) {
        if(err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: "Email sudah terdaftar" });
        return res.json({ success: false, message: "Gagal buat akun: " + err.message });
      }
      res.json({ success: true, userId: result.insertId, isPro: 0 });
    });
  } catch (err) { res.json({ success: false, message: "Server error hash" }); }
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  pool.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err || results.length === 0) return res.json({ success: false, message: "Email tidak ditemukan atau salah" });
    const user = results[0];
    try {
      const match = await bcrypt.compare(password, user.password);
      if (match) res.json({ success: true, userId: user.id, isPro: user.is_pro });
      else res.json({ success: false, message: "Password salah" });
    } catch (err) { res.json({ success: false, message: "Error validasi password" }); }
  });
});

app.post("/forgot-password", (req, res) => {
    const { email } = req.body;
    pool.query("SELECT id FROM users WHERE email = ?", [email], (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "Email tidak terdaftar" });
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
    if (!session || session.otp !== otp) return res.json({ success: false, message: "OTP Salah atau Kadaluarsa!" });
    if (Date.now() > session.expired) return res.json({ success: false, message: "OTP Kadaluarsa!" });

    try {
        const hashedPassword = await bcrypt.hash(newPassword, 10);
        pool.query("UPDATE users SET password = ? WHERE email = ?", [hashedPassword, email], (err) => {
            if (err) return res.json({ success: false, message: "Gagal update password" });
            delete app.locals[email]; 
            res.json({ success: true, message: "Password berhasil diubah" });
        });
    } catch (error) { res.json({ success: false, message: "Server error reset" }); }
});

app.post("/chat", (req, res) => {
  const { message, wallet, userId } = req.body;
  if (!userId) return res.json({ message: "User belum login" });

  const parsed = parseMessage(message);
  if (!parsed.amount) return res.json({ message: "Gue ga ngerti nominalnya bro 😅" });
  if (parsed.category === "allowance") return res.json({ message: `🍜 Tunjangan/Uang makan masuk sebesar Rp${parsed.amount.toLocaleString("id-ID")}` });
  
  const dompetDipakai = wallet || 'utama';
  pool.query("INSERT INTO transactions(user_id, amount, type, category, wallet) VALUES(?, ?, ?, ?, ?)", 
    [userId, parsed.amount, parsed.type, parsed.category, dompetDipakai], 
    (err) => {
      if (err) return res.json({ message: "Error simpan data MySQL" });
      res.json({ message: `Tercatat pos *${parsed.category}* sebesar Rp${parsed.amount.toLocaleString("id-ID")} memakai Dompet [${dompetDipakai}].` });
  });
});

app.post("/chat-ai", (req, res) => {
  const { message, userId } = req.body;
  if (!userId) return res.json({ reply: "Login dulu bro." });

  pool.query("SELECT * FROM transactions WHERE user_id = ?", [userId], (err, rows) => {
    if(err) return res.json({ reply: "Error baca data." });
    let income = 0; let expense = 0;
    rows.forEach(tx => { 
        // Parsing ke Number karena tipe BIGINT MySQL kadang dibaca String di Node.js
        const nominal = Number(tx.amount);
        if (tx.type === "income") income += nominal; 
        if (tx.type === "expense") expense += nominal; 
    });
    const balance = income - expense;
    if (message.toLowerCase().includes("roast")) return res.json({ reply: "💀 Dompet lu kerja rodi buat nongkrong." });
    if (balance < 0) return res.json({ reply: `💀 Lu nombok hidup.\n\nEvaluasi kilat:\n• Pangkas lifestyle` });
    res.json({ reply: '🔥 Cashflow aman terkendali. Lanjutkan bro!' });
  });
});

app.get('/summary', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ error: "Unauthorized" });
  
  pool.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at ASC', [userId], (err, rows) => {
    if (err) return res.json({ error: err.message });
    
    let income = 0; let expense = 0;
    rows.forEach(tx => { 
        tx.amount = Number(tx.amount); // Normalisasi angka MySQL
        if (tx.type === "income") income += tx.amount; 
        if (tx.type === "expense") expense += tx.amount; 
    });
    
    const riwayatTerbaru = [...rows].reverse().slice(0, 5);
    
    res.json({ 
        transactions: rows, 
        income, 
        expense, 
        balance: (income - expense), 
        healthScore: 100, 
        recurring: [], 
        recent: riwayatTerbaru,
        weeklySpend: 0 
    });
  });
});

app.get("/insight", (req, res) => {
  const userId = req.query.userId;
  if(!userId) return res.json({ income: 0, expense: 0, balance: 0, insight: ["Loading..."] });
  
  pool.query(`SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM transactions WHERE user_id=?`, [userId], (err, results) => {
    if(err || results.length === 0) return res.json({ income: 0, expense: 0, balance: 0, insight: ["✅ Stabil"] });
    const row = results[0];
    const income = Number(row.income) || 0; 
    const expense = Number(row.expense) || 0;
    res.json({ income, expense, balance: (income - expense), insight: ["✅ Stabil"] });
  });
});