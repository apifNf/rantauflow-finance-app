const express = require("express");
const cors = require("cors");
const path = require('path');
const fs = require('fs');
const bcrypt = require("bcrypt");
const multer = require("multer");
const midtransClient = require("midtrans-client");
const nodemailer = require("nodemailer");
const mysql = require("mysql2");
const cron = require("node-cron");

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(__dirname));
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
    console.log(`[TRAFFIC] ${req.method} ${req.url}`);
    next();
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.EMAIL_USER || 'emailkamu@gmail.com', pass: process.env.EMAIL_PASS || 'passwordaplikasi' }
});

const snap = new midtransClient.Snap({
  isProduction: true,
  serverKey: process.env.MIDTRANS_SERVER_KEY || 'RAHASIA_DI_HOSTINGER',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || 'RAHASIA_DI_HOSTINGER'
});

const uploadDir = path.join(__dirname, 'public', 'uploads', 'avatars');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, uploadDir); },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'avatar-' + req.body.userId + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, 
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Format ditolak! Hanya gambar yang diizinkan.'));
    }
});

// ================= FASE 2 & FASE 4: DATABASE CONNECTION =================
const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'rantauflow_db',
    waitForConnections: true, connectionLimit: 15, queueLimit: 0
});

pool.getConnection((err, connection) => {
    if (err) console.error("[CRITICAL ERROR] Gagal nyambung ke MySQL:", err.message);
    else {
        console.log("[SUKSES] Database MySQL Enterprise Terhubung!");
        
        connection.query(`CREATE TABLE IF NOT EXISTS users(
            id INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(255) UNIQUE, password VARCHAR(255), 
            name VARCHAR(255) DEFAULT NULL, avatar VARCHAR(255) DEFAULT NULL, tier_level TINYINT DEFAULT 0,
            wa_number VARCHAR(20) UNIQUE DEFAULT NULL, affiliate_code VARCHAR(50) UNIQUE DEFAULT NULL, 
            affiliate_balance BIGINT DEFAULT 0, referred_by VARCHAR(50) DEFAULT NULL
        )`);
        
        connection.query(`CREATE TABLE IF NOT EXISTS transactions(
            id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, amount BIGINT, type VARCHAR(50), 
            category VARCHAR(50), wallet VARCHAR(100) DEFAULT 'utama', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )`);

        connection.query("SHOW COLUMNS FROM users LIKE 'referred_by'", (err, results) => {
            if (results && results.length === 0) {
                console.log("[MIGRASI] Menambahkan kolom referred_by untuk Sistem Afiliasi 30%...");
                connection.query("ALTER TABLE users ADD COLUMN referred_by VARCHAR(50) DEFAULT NULL");
            }
        });

        connection.release();
    }
});

// ================= FASE 3: SMART NUDGES CRON =================
async function sendWhatsAppMessage(phoneNumber, textMessage) {
    try {
        const token = process.env.META_WA_TOKEN || 'TOKEN_SISTEM_META_KAMU';
        const phoneId = process.env.META_PHONE_ID || 'PHONE_ID_META_KAMU';
        await fetch(`https://graph.facebook.com/v17.0/${phoneId}/messages`, {
            method: 'POST', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ messaging_product: "whatsapp", to: phoneNumber, type: "text", text: { body: textMessage } })
        });
    } catch (err) { console.error("[SMART NUDGE ERROR]", err.message); }
}

cron.schedule('0 20 * * *', () => {
    pool.query("SELECT id, name, wa_number FROM users WHERE tier_level = 2 AND wa_number IS NOT NULL", (err, users) => {
        if (err || users.length === 0) return;
        users.forEach(user => {
            pool.query("SELECT * FROM transactions WHERE user_id = ? AND DATE(created_at) = CURDATE()", [user.id], (err, txs) => {
                if (err || txs.length === 0) return;
                let dailyExpense = 0; let dailyInvestmentLoss = 0;
                txs.forEach(tx => {
                    if (tx.type === 'expense') dailyExpense += Number(tx.amount);
                    if (tx.type === 'expense' && tx.category === 'investment') dailyInvestmentLoss += Number(tx.amount);
                });
                if (dailyInvestmentLoss > 500000) sendWhatsAppMessage(user.wa_number, `⚠️ *RantauFlow Smart Nudge*\n\nHalo ${user.name || 'Bro'}, sistem mendeteksi hari ini lu cutloss/depo kripto sampai *Rp${dailyInvestmentLoss.toLocaleString('id-ID')}* ya? \n\nIstirahat dulu bro, jangan sampai kena Revenge Trading!`);
                else if (dailyExpense > 1000000) sendWhatsAppMessage(user.wa_number, `🔥 *RantauFlow Roasting*\n\nHalo ${user.name || 'Bro'}, pengeluaran lu hari ini tembus *Rp${dailyExpense.toLocaleString('id-ID')}*! \n\nAwas boros bos, ingat target kebebasan finansial lu!`);
            });
        });
    });
});

app.get("/webhook/whatsapp", (req, res) => {
    if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === "TOKEN_RAHASIA_MU") res.status(200).send(req.query["hub.challenge"]);
    else res.sendStatus(403);
});
app.post("/webhook/whatsapp", (req, res) => { res.sendStatus(200); });

function parseMessage(text) {
  text = (text || "").toLowerCase(); let amount = 0; let category = "other"; let type = "expense";
  const match = text.match(/(\$)?(\d+(?:[.,]\d+)?)\s?(k|jt)?\b/i);
  if (match) {
    const isDollar = match[1] === "$"; let parsedNumber = parseFloat(match[2].replace(',', '.'));
    amount = parsedNumber; if (match[3] === "k") amount *= 1000; if (match[3] === "jt") amount *= 1000000; if (isDollar) amount *= 16300; 
  }
  const cryptoAssets = ["bitcoin", "btc", "ethereum", "eth", "solana", "sol", "doge", "usdt", "xrp", "pepe", "bnb", "ton"];
  const stockAssets = ["bbca", "bbri", "bmri", "bbni", "goto", "tlkm", "asii", "reksadana", "saham"];
  const exchanges = ["indodax", "mexc", "okx", "bybit", "binance", "cryptoinside"];
  const isInvestment = cryptoAssets.some(kw => text.includes(kw)) || stockAssets.some(kw => text.includes(kw)) || exchanges.some(kw => text.includes(kw));
  
  if (text.includes("fomo") || text.includes("memecoin") || text.includes("sangkut") || text.includes("liquid") || text.includes("mc") || text.includes("loss")) { type = "expense"; category = "investment"; }
  else if (text.includes("profit") || text.includes("cuan") || text.includes("tp") || text.includes("wd") || text.includes("dividen")) { type = "income"; category = "investment"; } 
  else if (isInvestment || text.includes("crypto") || text.includes("invest") || text.includes("depo")) { type = (text.includes("jual") || text.includes("cair")) ? "income" : "expense"; category = "investment"; } 
  else if (text.includes("tabung") || text.includes("nabung") || text.includes("save")) { type = "saving"; category = "saving"; } 
  else if (text.includes("gaji") || text.includes("bonus")) { type = "income"; category = "salary"; } 
  else if (text.includes("party") || text.includes("club") || text.includes("nongkrong") || text.includes("slot")) { type = "expense"; category = "lifestyle"; } 
  else if (text.includes("grab") || text.includes("taxi") || text.includes("gojek")) { type = "expense"; category = "transport"; } 
  else if (text.includes("makan") || text.includes("kopi")) { category = "food"; }
  return { amount, type, category };
}

// ================= ENDPOINT AUTENTIKASI =================
app.get("/", (req, res) => { res.send("RantauFlow Enterprise API Running Perfectly"); });

app.post("/register", async (req, res) => {
  const { email, password, referredBy } = req.body;
  if (!email || !password) return res.json({ success: false, message: "Data tidak lengkap" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    pool.query("INSERT INTO users(email, password, tier_level, referred_by) VALUES(?, ?, 0, ?)", [email, hashedPassword, referredBy || null], (err, result) => {
      if (err) {
        if(err.code === 'ER_DUP_ENTRY') return res.json({ success: false, message: "Email sudah terdaftar" });
        return res.json({ success: false, message: "Gagal buat akun" });
      }
      res.json({ success: true, userId: result.insertId, tierLevel: 0 });
    });
  } catch (err) { res.json({ success: false, message: "Server error hash" }); }
});

app.post("/login", (req, res) => {
  const { email, password } = req.body;
  pool.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err || results.length === 0) return res.json({ success: false, message: "Email tidak ditemukan/salah" });
    const user = results[0];
    try {
      const match = await bcrypt.compare(password, user.password);
      if (match) res.json({ success: true, userId: user.id, tierLevel: user.tier_level });
      else res.json({ success: false, message: "Password salah" });
    } catch (err) { res.json({ success: false, message: "Error validasi password" }); }
  });
});

app.get("/profile", (req, res) => {
    const { userId } = req.query;
    if (!userId) return res.json({ success: false, message: "Unauthorized" });

    pool.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "User tidak ditemukan" });
        let user = results[0];
        
        if (!user.affiliate_code) {
            const newCode = 'RF' + user.id + Math.random().toString(36).substring(2, 6).toUpperCase();
            pool.query("UPDATE users SET affiliate_code = ? WHERE id = ?", [newCode, userId]);
            user.affiliate_code = newCode;
        }

        res.json({ success: true, user: {
            id: user.id, name: user.name, email: user.email, avatar: user.avatar, tier_level: user.tier_level, 
            wa_number: user.wa_number, affiliate_code: user.affiliate_code, affiliate_balance: user.affiliate_balance
        }});
    });
});

app.post("/api/user/update-profile", upload.single('avatar'), (req, res) => {
    const { userId, name, waNumber, oldPassword, newPassword } = req.body;
    pool.query("SELECT * FROM users WHERE id = ?", [userId], async (err, results) => {
        if (err || results.length === 0) return res.json({ success: false, message: "User tidak ditemukan" });
        const user = results[0];
        let queryUpdates = []; let queryParams = [];

        if (name && name !== user.name) { queryUpdates.push("name = ?"); queryParams.push(name); }
        if (waNumber && waNumber !== user.wa_number) {
            let cleanNum = waNumber.replace(/\D/g,''); if(cleanNum.startsWith('0')) cleanNum = '62' + cleanNum.substring(1);
            queryUpdates.push("wa_number = ?"); queryParams.push(cleanNum);
        }
        if (req.file) { queryUpdates.push("avatar = ?"); queryParams.push('/public/uploads/avatars/' + req.file.filename); }
        if (oldPassword && newPassword) {
            const match = await bcrypt.compare(oldPassword, user.password);
            if (!match) return res.json({ success: false, message: "Password lama salah!" });
            queryUpdates.push("password = ?"); queryParams.push(await bcrypt.hash(newPassword, 10));
        }

        if (queryUpdates.length === 0) return res.json({ success: true, message: "Tidak ada perubahan" });
        pool.query(`UPDATE users SET ${queryUpdates.join(', ')} WHERE id = ?`, [...queryParams, userId], (updateErr) => {
            if (updateErr) return res.json({ success: false, message: "Gagal update database" });
            pool.query("SELECT * FROM users WHERE id = ?", [userId], (err2, res2) => { res.json({ success: true, message: "Profil diperbarui!", user: res2[0] }); });
        });
    });
});

// ================= FASE 4: MESIN REVENUE SHARE 30% MIDTRANS =================
app.post('/create-transaction', async (req, res) => {
    const { userId, tierLevel, price } = req.body;
    try {
        const transaction = await snap.createTransaction({
            transaction_details: { order_id: `RF-${tierLevel}-${userId}-${Date.now()}`, gross_amount: price },
            customer_details: { first_name: "Member", email: `user${userId}@rantauflow.com` }
        });
        res.json({ token: transaction.token });
    } catch (e) { res.json({ error: e.message }); }
});

app.post('/midtrans-notification', async (req, res) => {
    try {
        const statusResponse = await snap.transaction.notification(req.body);
        const orderId = statusResponse.order_id;
        const transactionStatus = statusResponse.transaction_status;

        if (transactionStatus === 'capture' || transactionStatus === 'settlement'){
            const parts = orderId.split('-');
            if(parts.length >= 3) {
                const tier = parseInt(parts[1]);
                const uId = parseInt(parts[2]);
                const grossAmount = parseInt(statusResponse.gross_amount);

                pool.query("UPDATE users SET tier_level = ? WHERE id = ?", [tier, uId]);

                pool.query("SELECT referred_by FROM users WHERE id = ?", [uId], (err, users) => {
                    if (users && users.length > 0 && users[0].referred_by) {
                        const refCode = users[0].referred_by;
                        const komisi = Math.floor(grossAmount * 0.30);
                        pool.query("UPDATE users SET affiliate_balance = affiliate_balance + ? WHERE affiliate_code = ?", [komisi, refCode]);
                    }
                });
            }
        }
        res.status(200).send("OK");
    } catch (e) { res.status(500).send("Error"); }
});

// ================= ENDPOINT CHAT & DATA =================
app.post("/chat", (req, res) => {
  const { message, wallet, userId } = req.body;
  const parsed = parseMessage(message);
  if (!parsed.amount) return res.json({ message: "Sistem butuh angka/nominal bro, contoh: fomo memecoin 500k 😅" });
  pool.query("INSERT INTO transactions(user_id, amount, type, category, wallet) VALUES(?, ?, ?, ?, ?)", [userId, parsed.amount, parsed.type, parsed.category, wallet || 'utama'], (err) => {
      res.json({ message: `Tercatat pos *${parsed.category}* sebesar Rp${parsed.amount.toLocaleString("id-ID")}` });
  });
});

app.post("/chat-ai", (req, res) => { res.json({ reply: '💡 Sistem RantauFlow memantau keuanganmu.' }); });

app.get('/summary', (req, res) => {
  const userId = req.query.userId;
  pool.query('SELECT * FROM transactions WHERE user_id = ? ORDER BY created_at ASC', [userId], (err, rows) => {
    if (err) return res.json({ error: err.message });
    let income = 0; let expense = 0;
    rows.forEach(tx => { tx.amount = Number(tx.amount); if (tx.type === "income") income += tx.amount; if (tx.type === "expense") expense += tx.amount; });
    res.json({ transactions: rows, income, expense, balance: (income - expense), healthScore: 100, recurring: [], recent: [...rows].reverse().slice(0, 5) });
  });
});

app.get("/insight", (req, res) => {
  const userId = req.query.userId;
  pool.query(`SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM transactions WHERE user_id=?`, [userId], (err, results) => {
    if(err || results.length === 0) return res.json({ income: 0, expense: 0, balance: 0, insight: ["✅ Stabil"] });
    res.json({ income: Number(results[0].income) || 0, expense: Number(results[0].expense) || 0, balance: (Number(results[0].income) - Number(results[0].expense)), insight: ["✅ Stabil"] });
  });
});

// ================= FASE 5: MARKET TRACKER REALTIME (CORS BYPASS & CACHE) =================
const marketCache = {
    crypto: { data: null, lastFetch: 0 },
    saham: { data: null, lastFetch: 0 },
    emas: { data: null, lastFetch: 0 },
    kurs: { data: null, lastFetch: 0 }
};
const CACHE_DURATION = 5 * 60 * 1000; // Cache 5 menit biar server tidak jebol limit API

app.get('/api/market/:type', async (req, res) => {
    const { type } = req.params;
    const now = Date.now();

    if (marketCache[type] && marketCache[type].data && (now - marketCache[type].lastFetch < CACHE_DURATION)) {
        return res.json({ success: true, data: marketCache[type].data, cached: true });
    }

    try {
        let result = [];
        
        // [TWEAK KEAMANAN] Topeng User-Agent agar Yahoo Finance tidak memblokir server kita
        const fetchOptions = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json'
            }
        };
        
        if (type === 'crypto') {
            const response = await fetch('https://api.coingecko.com/api/v3/coins/markets?vs_currency=idr&order=market_cap_desc&per_page=10&page=1&sparkline=false');
            const data = await response.json();
            result = data.map(c => ({ name: c.name, symbol: c.symbol.toUpperCase(), price: c.current_price, change: c.price_change_percentage_24h }));
        } 
        else if (type === 'saham') {
            const symbols = 'BBCA.JK,BBRI.JK,BMRI.JK,BBNI.JK,TLKM.JK,ASII.JK,GOTO.JK,AMMN.JK,BREN.JK,BYAN.JK';
            const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`, fetchOptions);
            const data = await response.json();
            
            if(!data.quoteResponse || !data.quoteResponse.result) throw new Error("Diblokir Yahoo");
            
            result = data.quoteResponse.result.map(s => ({ 
                name: s.shortName || s.longName || s.symbol, 
                symbol: s.symbol.replace('.JK', ''), 
                price: s.regularMarketPrice, 
                change: s.regularMarketChangePercent 
            }));
        }
        else if (type === 'emas') {
            // Menarik 3 data sekaligus: Emas (GC=F), Perak (SI=F), dan Kurs USD-IDR (IDR=X)
            const response = await fetch(`https://query1.finance.yahoo.com/v7/finance/quote?symbols=GC=F,SI=F,IDR=X`, fetchOptions);
            const data = await response.json();
            const quotes = data.quoteResponse.result;
            
            const gold = quotes.find(q => q.symbol === 'GC=F');
            const silver = quotes.find(q => q.symbol === 'SI=F');
            const usdIdr = quotes.find(q => q.symbol === 'IDR=X').regularMarketPrice;

            // Rumus Akurat: (Harga USD per Troy Ounce * Kurs Rupiah) / 31.1035 Gram
            const gramPriceGold = (gold.regularMarketPrice * usdIdr) / 31.1035;
            const gramPriceSilver = (silver.regularMarketPrice * usdIdr) / 31.1035;

            result = [
                { name: 'Emas Global (Per Gram)', symbol: 'XAU/IDR', price: gramPriceGold, change: gold.regularMarketChangePercent },
                { name: 'Perak / Silver (Per Gram)', symbol: 'XAG/IDR', price: gramPriceSilver, change: silver.regularMarketChangePercent }
            ];
        }
        else if (type === 'kurs') {
            const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD');
            const data = await response.json();
            const idrRate = data.rates.IDR;
            const targets = ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'AUD', 'MYR', 'CNY', 'SAR', 'HKD'];
            result = targets.map(cur => {
                const price = idrRate / data.rates[cur];
                return { name: `IDR vs ${cur}`, symbol: `${cur}/IDR`, price: price, change: 0 }; 
            });
        }

        if (result.length > 0) {
            marketCache[type] = { data: result, lastFetch: now };
            return res.json({ success: true, data: result, cached: false });
        } else {
            return res.status(500).json({ success: false, message: "Data kosong" });
        }
    } catch (error) {
        console.error(`[MARKET API ERROR - ${type}]`, error.message);
        if (marketCache[type] && marketCache[type].data) {
            return res.json({ success: true, data: marketCache[type].data, cached: true, fallback: true });
        }
        res.status(500).json({ success: false, message: "Gagal mengambil data pasar" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => { console.log(`[SUKSES] Server RantauFlow Enterprise hidup di port ${PORT}`); });