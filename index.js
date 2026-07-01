console.log("Aplikasi RantauFlow sedang mencoba untuk start...");
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const midtransClient = require("midtrans-client");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ================= SETUP MIDTRANS =================
const snap = new midtransClient.Snap({
  isProduction: false,
  serverKey: process.env.MIDTRANS_SERVER_KEY || 'RAHASIA_DI_HOSTINGER',
  clientKey: process.env.MIDTRANS_CLIENT_KEY || 'RAHASIA_DI_HOSTINGER'
});
// ==================================================

const db = new sqlite3.Database("./database.db");

// ================= DB & AUTO-MIGRATION =================
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE,
      password TEXT,
      is_pro INTEGER DEFAULT 0 
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions(
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      amount INTEGER,
      type TEXT,
      category TEXT,
      wallet TEXT DEFAULT 'utama',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`ALTER TABLE users ADD COLUMN is_pro INTEGER DEFAULT 0`, (err) => {});
  db.run(`ALTER TABLE transactions ADD COLUMN wallet TEXT DEFAULT 'utama'`, (err) => {});
});

// ================= PARSER (KOSAKATA UPGRADE TRADING/CRYPTO) =================
function parseMessage(text) {
  text = (text || "").toLowerCase();

  let amount = 0;
  let category = "other";
  let type = "expense";

  // Mendeteksi nominal uang (Rp maupun $)
  const match = text.match(/(\$)?(\d+)\s?(k|jt)?\b/i);

  if (match) {
    const isDollar = match[1] === "$";
    amount = parseInt(match[2]);

    if (match[3] === "k") amount *= 1000;
    if (match[3] === "jt") amount *= 1000000;
    if (isDollar) amount *= 16300; // Kurs konversi dollar otomatis
  }

  // LOGIKA KOSAKATA BARU: INVESTASI & TRADING
  if (text.includes("profit") || text.includes("cuan") || text.includes("gain") || text.includes("wd")) {
    type = "income";
    category = "investment";
  } else if (text.includes("rugi") || text.includes("loss") || text.includes("cutloss") || text.includes("boncos") || text.includes("liquid")) {
    type = "expense";
    category = "investment";
  } else if (text.includes("crypto") || text.includes("forex") || text.includes("saham") || text.includes("invest") || text.includes("beli koin")) {
    // Jika hanya mencatat aktivitas menaruh modal tanpa kata profit/rugi, masuk ke pengeluaran pos investasi
    type = "expense";
    category = "investment";
  } 
  // Kosakata bawaan sebelumnya
  else if (text.includes("tabung") || text.includes("nabung") || text.includes("save")) {
    type = "saving";
    category = "saving";
  } else if (text.includes("gaji") || text.includes("bonus") || text.includes("masuk")) {
    type = "income";
    category = "salary";
  } else if (text.includes("uang makan") || text.includes("meal allowance")) {
    type = "income";
    category = "allowance";
  } else if (text.includes("party") || text.includes("club") || text.includes("nongkrong") || text.includes("bar")) {
    type = "expense";
    category = "lifestyle";
  } else if (text.includes("grab") || text.includes("taxi")) {
    type = "expense";
    category = "transport";
  } else if (text.includes("makan") || text.includes("kopi")) {
    category = "food";
  }

  return { amount, type, category };
}

// ================= ROOT =================
app.get("/", (req, res) => {
  res.send("RantauFlow API Running");
});

// ================= MIDTRANS API =================
app.post("/api/checkout", async (req, res) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ success: false, message: "User tidak valid" });

  db.get("SELECT email FROM users WHERE id = ?", [userId], async (err, row) => {
    if (err || !row) return res.status(500).json({ success: false, message: "User tidak ditemukan" });

    const parameter = {
      transaction_details: {
        order_id: `RF-PRO-${userId}-${Date.now()}`,
        gross_amount: 9900
      },
      customer_details: { email: row.email },
      item_details: [{
        id: "PRO-1",
        price: 9900,
        quantity: 1,
        name: "RantauFlow PRO (1 Bulan)"
      }]
    };

    try {
      const transaction = await snap.createTransaction(parameter);
      res.json({ success: true, token: transaction.token });
    } catch (error) {
      res.status(500).json({ success: false, message: "Gagal membuat link pembayaran" });
    }
  });
});

app.post("/api/payment-notification", async (req, res) => {
  try {
    const notificationJson = req.body;
    const statusResponse = await snap.transaction.notification(notificationJson);
    const orderId = statusResponse.order_id;
    const transactionStatus = statusResponse.transaction_status;
    const fraudStatus = statusResponse.fraud_status;

    const userId = orderId.split('-')[2];

    if (transactionStatus === 'capture' || transactionStatus === 'settlement') {
      if (fraudStatus === 'accept' || !fraudStatus) {
        db.run("UPDATE users SET is_pro = 1 WHERE id = ?", [userId], (err) => {
          if (!err) console.log(`[Midtrans] SUCCESS! User ID ${userId} aktif PRO.`);
        });
      }
    }
    res.status(200).send("OK");
  } catch (error) {
    res.status(500).send("Server Error");
  }
});

// ================= REGISTER =================
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.json({ success: false, message: "Data tidak lengkap" });

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run("INSERT INTO users(email, password, is_pro) VALUES(?, ?, 0)", [email, hashedPassword], function (err) {
      if (err) return res.json({ success: false, message: "Email sudah terdaftar" });
      res.json({ success: true, userId: this.lastID, isPro: 0 });
    });
  } catch (err) { res.json({ success: false, message: "Server error" }); }
});

// ================= LOGIN =================
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  db.get("SELECT * FROM users WHERE email = ?", [email], async (err, row) => {
    if (err || !row) return res.json({ success: false, message: "Kredensial salah" });
    try {
      const match = await bcrypt.compare(password, row.password);
      if (match) res.json({ success: true, userId: row.id, isPro: row.is_pro });
      else res.json({ success: false, message: "Password salah" });
    } catch (err) { res.json({ success: false }); }
  });
});

// ================= CHAT SAVE =================
app.post("/chat", (req, res) => {
  const { message, wallet, userId } = req.body;
  if (!userId) return res.json({ message: "User belum login" });

  const parsed = parseMessage(message);
  if (!parsed.amount) return res.json({ message: "Gue ga ngerti nominalnya bro 😅" });

  if (parsed.category === "allowance") {
    return res.json({ message: `🍜 Tunjangan/Uang makan masuk sebesar Rp${parsed.amount.toLocaleString("id-ID")}` });
  }

  const dompetDipakai = wallet || 'utama';

  db.run(
    "INSERT INTO transactions(user_id, amount, type, category, wallet) VALUES(?, ?, ?, ?, ?)",
    [userId, parsed.amount, parsed.type, parsed.category, dompetDipakai],
    function (err) {
      if (err) return res.json({ message: "Error simpan data" });

      db.all("SELECT * FROM transactions WHERE user_id = ?", [userId], (err, rows) => {
        let expense = 0;
        let lifestyle = 0;
        let investment = 0;

        rows.forEach(tx => {
          if (tx.type === "expense") expense += tx.amount;
          if (tx.type === "expense" && tx.category === "lifestyle") lifestyle += tx.amount;
          if (tx.category === "investment" && tx.type === "expense") investment += tx.amount;
        });

        let warning = "";
        
        // Dinamika Roast khusus Trading / Investasi jika rugi besar
        if (parsed.category === "investment" && parsed.type === "expense") {
          const cryptoRoasts = [
            "📉 Waduh boncos! Portofolio crypto lu ikut kebakaran ya?",
            "💀 Lu ini trading forex apa sedekah sukarela ke market bro?",
            "🔥 Kurangi overtrading, jangan sampai tabungan kos ikut ter-liquidasi!"
          ];
          warning = cryptoRoasts[Math.floor(Math.random() * cryptoRoasts.length)];
        } else if (parsed.type === "expense" && expense > 0 && (lifestyle / expense) > .25) {
          warning = "💀 Lu bukan budgeting, lu sponsorship hobi nongkrong.";
        }

        res.json({ message: `Tercatat pos *${parsed.category}* sebesar Rp${parsed.amount.toLocaleString("id-ID")} memakai Dompet [${dompetDipakai}]. ${warning}` });
      });
    }
  );
});

// ================= CHAT AI (UPGRADE LOGIKA ROAST TRADING/FOREX) =================
app.post("/chat-ai", (req, res) => {
  const { message, userId } = req.body;
  if (!userId) return res.json({ reply: "Login dulu bro." });

  const text = (message || "").toLowerCase();

  db.all("SELECT * FROM transactions WHERE user_id = ?", [userId], (err, rows) => {
    let income = 0;
    let expense = 0;
    let categorySpend = {};

    rows.forEach(tx => {
      if (tx.type === "income") income += tx.amount;
      if (tx.type === "expense") {
        expense += tx.amount;
        categorySpend[tx.category] = (categorySpend[tx.category] || 0) + tx.amount;
      }
    });

    let topCategory = "other";
    let biggest = 0;
    for (let cat in categorySpend) {
      if (categorySpend[cat] > biggest) { biggest = categorySpend[cat]; topCategory = cat; }
    }

    let categoryAdvice = "";
    if (topCategory === "investment") categoryAdvice = "\n📈 Perputaran dana lu dominan di Trading/Investasi.\nInget pakai uang dingin, jangan all-in di koin micin!";
    if (topCategory === "lifestyle") categoryAdvice = "\n🍻 Pengeluaran nongkrong dominan. Kurangi afterparty.";
    if (topCategory === "food") categoryAdvice = "\n🍜 Makan nyedot cash harian.";

    // ROAST ENGINE (Ditambahkan materi trading crypto/forex)
    if (text.includes("roast")) {
      const roasts = [
        "💀 Dompet lu kerja rodi buat margin call.",
        "📉 Portofolio trading lu merah membara, cashflow ikut sekarat.",
        "🔥 Budget lu bukan rencana keuangan, ini taruhan tebak chart.",
        "☠ Pengeluaran lu hobi speedrun miskin demi koin micin."
      ];
      return res.json({ reply: roasts[Math.floor(Math.random() * roasts.length)] });
    }

    const balance = income - expense;
    // Ekspansi kata kunci finansial & pasar modal
    const financeKeywords = ['duit', 'keuangan', 'uang', 'cash', 'saldo', 'dompet', 'budget', 'finansial', 'trading', 'crypto', 'forex', 'profit', 'cuan'];
    const isAskingFinance = financeKeywords.some(keyword => text.includes(keyword));

    if (isAskingFinance) {
      if (balance === 0 && income === 0) return res.json({ reply: "Belum ada catatan pembukuan nih. Mulai catat data trading bisnis atau pengeluaran lu!"});
      
      let reply = "";
      if (balance < 0) {
        reply = `💀 Lu nombok hidup.\n\nEvaluasi kilat:\n• Amankan dana darurat di rekening fisik\n• Stop dulu trading leverage tinggi\n• Pangkas pengeluaran lifestyle\n\nAmankan sisa saldo mu bro!`;
      } else if (expense > income * 0.8) {
        reply = `⚠ Saldo kritis tersisa Rp${balance.toLocaleString("id-ID")}\n\nAnalisa:\nPengeluaran memakan ${Math.round((expense / income) * 100)}% dana masuk.${categoryAdvice}`;
      } else {
        reply = `🔥 Cashflow aman terkendali.\n\nPortofolio seimbang. Lu bisa lanjut kembangkan dana dingin ke instrumen investasi yang aman.`;
      }
      return res.json({ reply });
    }

    res.json({ reply: 'Gue paham soal pencatatan harian, trading, atau roast. Coba ketik "cek duit gue" atau "roast cashflow" 😅' });
  });
});

// ================= SUMMARY =================
app.get('/summary', (req, res) => {
  const userId = req.query.userId;
  if (!userId) return res.json({ error: "Unauthorized" });

  db.all('SELECT * FROM transactions WHERE user_id = ?', [userId], (err, rows) => {
    if (err) return res.json({ error: err.message });

    let income = 0;
    let expense = 0;
    let categorySpend = {};
    let weeklySpend = 0;
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    rows.forEach(tx => {
      if (tx.type === "income") income += tx.amount;
      if (tx.type === "expense") {
        expense += tx.amount;
        const cat = (tx.category || "other").toLowerCase();
        categorySpend[cat] = (categorySpend[cat] || 0) + tx.amount;

        if (tx.created_at) {
          const txTime = new Date(tx.created_at).getTime();
          if (!isNaN(txTime) && (now - txTime) < oneWeek) weeklySpend += tx.amount;
        }
      }
    });

    const balance = income - expense;
    const recent = rows.filter(tx => tx.type === "expense").slice(-5).reverse();

    let score = 100;
    if (income > 0) score = Math.round(100 - ((expense / income) * 80));
    else if (income === 0 && expense > 0) score = 0;

    let recurring = [];
    for (let cat in categorySpend) {
      if (income > 0 && categorySpend[cat] > income * 0.20) {
        recurring.push(`⚠️ ${cat} memakan ${Math.round((categorySpend[cat] / income) * 100)}% pemasukan`);
      }
    }

    res.json({ transactions: rows, income, expense, balance, healthScore: score, recurring, recent, weeklySpend });
  });
});

app.get('/top-category', (req, res) => {
  const userId = req.query.userId;
  db.get(`SELECT category, SUM(amount) total FROM transactions WHERE type='expense' AND user_id=? GROUP BY category ORDER BY total DESC LIMIT 1`, [userId], (err, row) => {
    res.json({ category: row?.category || 'Belum ada', total: row?.total || 0 });
  });
});

app.get("/summary/category", (req, res) => {
  const userId = req.query.userId;
  db.all(`SELECT category, SUM(amount) as total FROM transactions WHERE type='expense' AND user_id=? GROUP BY category`, [userId], (err, rows) => {
    if (err) return res.json({ data: [] });
    res.json({ data: rows });
  });
});

app.get("/insight", (req, res) => {
  const userId = req.query.userId;
  db.get(`SELECT SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income, SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense FROM transactions WHERE user_id=?`, [userId], (err, row) => {
    const income = row?.income || 0;
    const expense = row?.expense || 0;
    const balance = income - expense;

    db.all("SELECT category, SUM(amount) total FROM transactions WHERE type='expense' AND user_id=? GROUP BY category", [userId], (err, rows) => {
      let categoryMap = {};
      rows.forEach(x => { categoryMap[x.category] = x.total; });

      let topCategory = "other";
      let max = 0;
      for (let cat in categoryMap) {
        if (categoryMap[cat] > max) { max = categoryMap[cat]; topCategory = cat; }
      }

      let persen = expense > 0 ? (max / expense) * 100 : 0;
      let insight = [];

      if (income === 0 && expense === 0) {
        insight.push("👋 Selamat datang! Mulai catat keuangan atau profit trading mu.");
      } else {
        if (balance < 0) insight.push("🚨 Cashflow negatif");
        if (expense > income * 0.85) insight.push("💀 Duit hampir habis");
        if (topCategory === "investment") insight.push("📈 Perhatikan money management trading mu.");
        if (insight.length === 0) insight.push("✅ Stabil");
      }

      res.json({ income, expense, balance, insight });
    });
  });
});

// ================= SERVER =================
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server RantauFlow berhasil berjalan di port ${PORT}`);
});