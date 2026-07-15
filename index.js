const express = require("express");
const cors = require("cors");
const path = require('path');
const fs = require('fs');
const bcrypt = require("bcrypt");
const multer = require("multer");
const midtransClient = require("midtrans-client");
const nodemailer = require("nodemailer");
const mysql = require("mysql2");

const app = express();
app.use(cors());
app.use(express.json());

// Mengizinkan akses publik ke folder foto profil & file web
app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

// Pengecek Lalu Lintas: Log setiap request yang masuk ke server
app.use((req, res, next) => {
    console.log(`[TRAFFIC] ${req.method} ${req.url}`);
    next();
});

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
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY || 'RAHASIA_DI_HOSTINGER',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || 'RAHASIA_DI_HOSTINGER'
});

// ================= SETUP MULTER (UPLOAD FOTO PROFIL) =================
const uploadDir = path.join(__dirname, 'public', 'uploads', 'avatars');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true }); // Buat folder otomatis jika belum ada
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        // Format penamaan file: avatar-IDUSER-TIMESTAMP.jpg
        cb(null, 'avatar-' + req.body.userId + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // Batas ukuran maksimal 2MB
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Format ditolak! Hanya gambar yang diizinkan.'));
    }
});


// ================= FASE 2: DATABASE CONNECTION POOLING (MYSQL) =================
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rantauflow_db',
    waitForConnections: true,
    connectionLimit: 15,
    queueLimit: 0
});

// Tes Koneksi & Auto-Migrasi Tabel Otomatis
pool.getConnection((err, connection) => {
    if (err) {
        console.error("[CRITICAL ERROR] Gagal nyambung ke MySQL:", err.message);
    } else {
        console.log("[SUKSES] Database MySQL Enterprise Terhubung! Siap scale-up.");
        
        // Pembuatan Tabel Dasar dengan Tambahan Kolom Name & Avatar
        const createUsers = `CREATE TABLE IF NOT EXISTS users(
            id INT AUTO_INCREMENT PRIMARY KEY, 
            email VARCHAR(255) UNIQUE, 
            password VARCHAR(255), 
            name VARCHAR(255) DEFAULT NULL,
            avatar VARCHAR(255) DEFAULT NULL,
            tier_level TINYINT DEFAULT 0,
            wa_number VARCHAR(20) UNIQUE DEFAULT NULL,
            affiliate_code VARCHAR(50) UNIQUE DEFAULT NULL,
            affiliate_balance BIGINT DEFAULT 0
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

        // AUTO-MIGRASI: Cek apakah masih pakai format lama (is_pro) atau butuh kolom name/avatar
        connection.query("SHOW COLUMNS FROM users LIKE 'is_pro'", (err, results) => {
            if (results && results.length > 0) {
                console.log("[MIGRASI] Mengupgrade tabel users ke versi Enterprise (Tier & Affiliate)...");
                connection.query("ALTER TABLE users CHANGE is_pro tier_level TINYINT DEFAULT 0");
                connection.query("ALTER TABLE users ADD COLUMN wa_number VARCHAR(20) UNIQUE DEFAULT NULL");
                connection.query("ALTER TABLE users ADD COLUMN affiliate_code VARCHAR(50) UNIQUE DEFAULT NULL");
                connection.query("ALTER TABLE users ADD COLUMN affiliate_balance BIGINT DEFAULT 0");
            }
        });

        connection.query("SHOW COLUMNS FROM users LIKE 'name'", (err, results) => {
            if (results && results.length === 0) {
                console.log("[MIGRASI] Menambahkan kolom Name & Avatar ke tabel users...");
                connection.query("ALTER TABLE users ADD COLUMN name VARCHAR(255) DEFAULT NULL");
                connection.query("ALTER TABLE users ADD COLUMN avatar VARCHAR(255) DEFAULT NULL");
            }
        });

        connection.release();
    }
});


// ================= FASE 3: WEBHOOK WHATSAPP (RUTE UTAMA META) =================
app.get("/webhook/whatsapp", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === "TOKEN_RAHASIA_MU") {
        console.log("[WEBHOOK] Verifikasi Berhasil!");
        res.status(200).send(challenge);
    } else {
        console.log("[WEBHOOK] Verifikasi Gagal! Token tidak cocok.");
        res.sendStatus(403);
    }
});

app.post("/webhook/whatsapp", (req, res) => {
    res.sendStatus(200); // Wajib balas 200 OK ke Meta secepatnya
    console.log("[INCOMING WEBHOOK] Terdeteksi request POST dari Meta!");
    
    try {
        const body = req.body;
        if (body.object === "whatsapp_business_account") {
            console.log("[PAYLOAD] Data pesan:", JSON.stringify(body, null, 2));
        } else {
            console.log("[PAYLOAD] Bukan dari WhatsApp Business Account");
        }
    } catch (error) {
        console.error("[ERROR] Gagal memproses data masuk:", error);
    }
});


// ================= KOSAKATA AI SUPER ADVANCED (TRADING DEGEN MODE) =================
function parseMessage(text) {
  text = (text || "").toLowerCase();
  let amount = 0; let category = "other"; let type = "expense";
  
  const match = text.match(/(\$)?(\d+(?:[.,]\d+)?)\s?(k|jt)?\b/i);
  if (match) {
    const isDollar = match[1] === "$"; 
    let parsedNumber = parseFloat(match[2].replace(',', '.'));
    
    amount = parsedNumber;
    if (match[3] === "k") amount *= 1000;
    if (match[3] === "jt") amount *= 1000000;
    if (isDollar) amount *= 16300; 
  }
  
  const cryptoAssets = ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "doge", "usdt", "xrp", "pepe", "bnb", "ton"];
  const stockAssets = ["bbca", "bbri", "bmri", "bbni", "goto", "tlkm", "asii", "reksadana", "obligasi", "saham"];
  const exchanges = ["indodax", "mexc", "okx", "bybit", "binance", "cryptoinside"];
  
  const isInvestment = cryptoAssets.some(kw => text.includes(kw)) || 
                       stockAssets.some(kw => text.includes(kw)) || 
                       exchanges.some(kw => text.includes(kw));
  
  if (text.includes("fomo") || text.includes("memecoin") || text.includes("shitcoin") || text.includes("koin micin") || text.includes("sangkut")) { type = "expense"; category = "investment"; }
  else if (text.includes("liquid") || text.includes("mc") || text.includes("margin call") || text.includes("futures") || text.includes("loss") || text.includes("cutloss") || text.includes("rugi") || text.includes("boncos")) { type = "expense"; category = "investment"; }
  else if (text.includes("profit") || text.includes("cuan") || text.includes("tp") || text.includes("take profit") || text.includes("wd") || text.includes("withdraw") || text.includes("dividen")) { type = "income"; category = "investment"; } 
  else if (isInvestment || text.includes("crypto") || text.includes("forex") || text.includes("invest") || text.includes("beli koin") || text.includes("depo")) { 
      if (text.includes("jual") || text.includes("sell") || text.includes("cair")) { type = "income"; } 
      else { type = "expense"; }
      category = "investment"; 
  } 
  else if (text.includes("tabung") || text.includes("nabung") || text.includes("save")) { type = "saving"; category = "saving"; } 
  else if (text.includes("gaji") || text.includes("bonus") || text.includes("masuk")) { type = "income"; category = "salary"; } 
  else if (text.includes("uang makan") || text.includes("meal allowance")) { type = "income"; category = "allowance"; } 
  else if (text.includes("party") || text.includes("club") || text.includes("nongkrong") || text.includes("bar") || text.includes("judi") || text.includes("slot")) { type = "expense"; category = "lifestyle"; } 
  else if (text.includes("grab") || text.includes("taxi") || text.includes("gojek") || text.includes("passapp")) { type = "expense"; category = "transport"; } 
  else if (text.includes("makan") || text.includes("kopi")) { category = "food"; }
  
  return { amount, type, category };
}

// ================= ENDPOINT AUTENTIKASI =================
app.get("/", (req, res) => { res.send("RantauFlow Enterprise API Running Perfectly"); });

app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, message: "Data tidak lengkap" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    pool.query("INSERT INTO users(email, password, tier_level) VALUES(?, ?, 0)", [email, hashedPassword], (err, result) => {
      if (err) {
        if(err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: "Email sudah terdaftar" });
        return res.json({ success: false, message: "Gagal buat akun: " + err.message });
      }
      res.json({ success: true, userId: result.insertId, tierLevel: 0 });
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
      const tLevel = user.tier_level !== undefined ? user.tier_level : (user.is_pro || 0);
      
      if (match) res.json({ success: true, userId: user.id, tierLevel: tLevel });
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

// ================= ENDPOINT MANAJEMEN PROFIL (BARU) =================

// Endpoint untuk mengambil data nama & avatar saat dashboard diload
app.get("/profile", (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, message: "Unauthorized" });

    pool.query("SELECT id, email, name, avatar, tier_level FROM users WHERE id = ?", [userId], (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "User tidak ditemukan" });
        res.json({ success: true, user: results[0] });
    });
});

// Endpoint untuk update Profil (Nama, Sandi, & Foto Avatar)
app.post("/api/user/update-profile", upload.single('avatar'), (req, res) => {
    const { userId, name, oldPassword, newPassword } = req.body;
    if (!userId) return res.json({ success: false, message: "Unauthorized" });

    pool.query("SELECT * FROM users WHERE id = ?", [userId], async (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "User tidak ditemukan" });
        const user = results[0];

        let queryUpdates = [];
        let queryParams = [];

        // 1. Update Nama
        if (name && name !== user.name) {
            queryUpdates.push("name = ?");
            queryParams.push(name);
        }

        // 2. Update File Foto Avatar
        if (req.file) {
            const avatarPath = '/public/uploads/avatars/' + req.file.filename;
            queryUpdates.push("avatar = ?");
            queryParams.push(avatarPath);
        }

        // 3. Update Password
        if (oldPassword && newPassword) {
            const match = await bcrypt.compare(oldPassword, user.password);
            if (!match) return res.json({ success: false, message: "Password lama salah!" });
            const hashedNew = await bcrypt.hash(newPassword, 10);
            queryUpdates.push("password = ?");
            queryParams.push(hashedNew);
        }

        // Jika tidak ada data yang dilempar untuk diubah
        if (queryUpdates.length === 0) {
            return res.json({ success: true, message: "Tidak ada perubahan", user: { name: user.name, avatar: user.avatar } });
        }

        // Jalankan Query Update secara Dinamis
        const sql = `UPDATE users SET ${queryUpdates.join(', ')} WHERE id = ?`;
        queryParams.push(userId);

        pool.query(sql, queryParams, (updateErr) => {
            if (updateErr) return res.json({ success: false, message: "Gagal update database" });
            
            // Kembalikan data terbaru ke frontend agar langsung berubah di dashboard
            pool.query("SELECT id, email, name, avatar, tier_level FROM users WHERE id = ?", [userId], (err2, res2) => {
                res.json({ success: true, message: "Profil berhasil diperbarui!", user: res2[0] });
            });
        });
    });
});


// ================= ENDPOINT PEMBAYARAN MIDTRANS =================
app.post('/create-transaction', async (req, res) => {
    const { userId, tierLevel, price } = req.body;
    if (!userId) return res.json({ error: "User belum login" });

    let orderId = `RF-${tierLevel}-${userId}-${Date.now()}`;
    let parameter = {
        transaction_details: { order_id: orderId, gross_amount: price },
        customer_details: { first_name: "Member", email: `user${userId}@rantauflow.com` }
    };
    
    try {
        const transaction = await snap.createTransaction(parameter);
        res.json({ token: transaction.token });
    } catch (e) {
        res.json({ error: e.message });
    }
});

app.post('/midtrans-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        let orderId = statusResponse.order_id;
        let transactionStatus = statusResponse.transaction_status;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement'){
            const parts = orderId.split('-');
            if(parts.length >= 3) {
                const tier = parseInt(parts[1]);
                const uId = parseInt(parts[2]);
                pool.query("UPDATE users SET tier_level = ? WHERE id = ?", [tier, uId]);
            }
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// ================= ENDPOINT CHAT & AI ROASTING PEDAS =================
app.post("/chat", (req, res) => {
  const { message, wallet, userId } = req.body;
  if (!userId) return res.json({ message: "User belum login" });

  const parsed = parseMessage(message);
  if (!parsed.amount) return res.json({ message: "Sistem butuh angka/nominal bro, contoh: fomo memecoin 500k 😅" });
  if (parsed.category === "allowance") return res.json({ message: `🍜 Tunjangan/Uang makan masuk sebesar Rp${parsed.amount.toLocaleString("id-ID")}` });
  
  const dompetDipakai = wallet || 'utama';
  const text = message.toLowerCase();
  let miniRoast = "";

  if (parsed.category === "investment") {
      if (text.includes("loss") || text.includes("cutloss") || text.includes("liquid") || text.includes("mc") || text.includes("rugi") || text.includes("fomo") || text.includes("memecoin") || text.includes("sangkut")) {
          miniRoast = "Jangan sering-sering kaya gini bro. Trading itu butuh analisa, trade boleh fomo jangan. Jaga psikologis dan manajemen risikomu!";
      } else if (parsed.type === "income") {
          miniRoast = "Cakep! Profit is profit. Jangan lupa amankan cuan ke USDT atau tarik ke rekening dingin, jangan di-all in lagi.";
      } else {
          miniRoast = "Nah, kelakuan beli aset gini yang bisa ngubah hidup lu di masa depan. Kunci rapat-rapat, diamond hands!";
      }
  } else if (parsed.category === "lifestyle") {
      miniRoast = "Nongkrong dan hedon terooos. Inget umur bro, dompet juga butuh istirahat.";
  } else if (parsed.category === "saving") {
      miniRoast = "Mantap! Nabung adalah jalan ninja menuju kebebasan finansial. Lanjutkan habit ini.";
  }

  const finalMessage = miniRoast 
      ? `Tercatat pos *${parsed.category}* sebesar Rp${parsed.amount.toLocaleString("id-ID")} memakai Dompet [${dompetDipakai}].\n\n🤖 AI: ${miniRoast}`
      : `Tercatat pos *${parsed.category}* sebesar Rp${parsed.amount.toLocaleString("id-ID")} memakai Dompet [${dompetDipakai}].`;

  pool.query("INSERT INTO transactions(user_id, amount, type, category, wallet) VALUES(?, ?, ?, ?, ?)", 
    [userId, parsed.amount, parsed.type, parsed.category, dompetDipakai], 
    (err) => {
      if (err) return res.json({ message: "Error simpan data MySQL" });
      res.json({ message: finalMessage });
  });
});

app.post("/chat-ai", (req, res) => {
  const { message, userId } = req.body;
  if (!userId) return res.json({ reply: "Login dulu bro." });

  pool.query("SELECT * FROM transactions WHERE user_id = ?", [userId], (err, rows) => {
    if(err) return res.json({ reply: "Error baca data." });
    
    let income = 0; let expense = 0;
    let tradingLossCount = 0; let totalTradingLoss = 0;

    rows.forEach(tx => { 
        const nominal = Number(tx.amount);
        if (tx.type === "income") income += nominal; 
        if (tx.type === "expense") expense += nominal; 
        if (tx.category === "investment" && tx.type === "expense") {
            tradingLossCount++;
            totalTradingLoss += nominal;
        }
    });

    const text = message.toLowerCase();
    const balance = income - expense;

    if (text.includes("fomo") || text.includes("meme") || text.includes("shitcoin") || text.includes("micin")) {
        return res.json({ reply: `🔥 ROASTING: Beli memecoin karena FOMO masuk grup Telegram? Lu pikir lu siapa, bandar besar? Lu cuma jadi *exit liquidity* (tumbal) buat para Paus yang udah serok dari bawah! \n\n💡 SOLUSI: Hapus aplikasi exchange lu sekarang. Peluang lu menang main beginian lebih kecil dari kasino. Kalau lu emang mau investasi, mulai belajar fundamental, teknikal (Price Action), atau masukin duit lu ke ETF/Reksadana yang dikelola orang pinter!` });
    }
    if (text.includes("liquid") || text.includes("mc") || text.includes("margin") || text.includes("futures") || text.includes("gorengan")) {
        return res.json({ reply: `🔥 ROASTING: Kena likuidasi lagi? Pake leverage x100 ngerasa jadi pro trader padahal analisa lu cuma modal 'feeling' sama ludah influencer YouTube? \n\n💡 SOLUSI: Stop trading futures/margin! Mental dan *risk management* lu masih selevel anak TK. Main Spot aja dulu, cutloss dengan disiplin, dan pantau kalender ekonomi sebelum buka posisi.` });
    }
    if ((text.includes("rugi") || text.includes("loss") || text.includes("cutloss") || text.includes("boncos")) && tradingLossCount >= 3) {
        return res.json({ reply: `🔥 ULTIMATE ROAST: Gue liat data lu, lu udah LOSS TRADING ${tradingLossCount} kali berturut-turut! Total duit lu yang dimakan market: Rp ${totalTradingLoss.toLocaleString("id-ID")}! \nLu bukan investasi bro, lu lagi donasi paksa ke market! Lu kena sindrom *Revenge Trading* (Balas dendam pengen balik modal instan). \n\n💡 SOLUSI DARURAT: STOP TRADING 1 MINGGU FULL. Market nggak akan ke mana-mana, tapi duit lu bisa habis ke 0. Puasa buka chart, evaluasi jurnal lu, dan sadar diri emosi lu lagi hancur lebur.` });
    }
    if (text.includes("roast")) {
        if (tradingLossCount > 0) return res.json({ reply: `🔥 ROASTING: Gaya lu elit, portofolio lu sulit! Dompet lu isinya cuma harapan kosong nungguin koin naik 1000% biar bisa pamer. \n\n💡 EVALUASI: Kurangi halu, bangun *cashflow* dari skill dunia nyata lu dulu.`});
        if (balance < 0) return res.json({ reply: `💀 ROASTING: Lu nombok hidup bro. Pengeluaran lu lebih gede dari pemasukan. \n\n💡 SOLUSI: Pangkas lifestyle nongkrong lu, lu bukan sultan.` });
        return res.json({ reply: "🔥 Cashflow lu aman bulan ini. Tumben lu bener ngatur duit." });
    }

    res.json({ reply: '💡 Sistem RantauFlow mendengarkan. Ketik "roast gue" atau curhatin rugi trading lu buat dievaluasi AI.' });
  });
});

// ================= ENDPOINT SUMMARY =================
app.get('/summary', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ error: "Unauthorized" });
  
  pool.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at ASC', [userId], (err, rows) => {
    if (err) return res.json({ error: err.message });
    
    let income = 0; let expense = 0;
    rows.forEach(tx => { 
        tx.amount = Number(tx.amount); 
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

// ================= FASE 1: BUKA PINTU SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SUKSES] Server RantauFlow Enterprise hidup tenang di port ${PORT}`);
});