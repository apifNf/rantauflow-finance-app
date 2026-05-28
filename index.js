const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const db = new sqlite3.Database("./database.db");

// ================= DB =================

db.serialize(()=>{

 db.run(`
 CREATE TABLE IF NOT EXISTS users(
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   email TEXT UNIQUE,
   password TEXT
 )
 `);

 db.run(`
 CREATE TABLE IF NOT EXISTS transactions(
   id INTEGER PRIMARY KEY AUTOINCREMENT,
   user_id INTEGER,
   amount INTEGER,
   type TEXT,
   category TEXT,
   created_at DATETIME DEFAULT CURRENT_TIMESTAMP
 )
 `);

});


// ================= PARSER =================
function parseMessage(text){
 text=(text||"").toLowerCase();

 let amount=0;
 let category="other";
 let type="expense";

 const match=text.match(/(\$)?(\d+)\s?(k|jt)?\b/i);

 if(match){
   const isDollar=match[1]==="$";
   amount=parseInt(match[2]);

   if(match[3]==="k") amount*=1000;
   if(match[3]==="jt") amount*=1000000;
   if(isDollar) amount*=16300;
 }

 if(
 text.includes("tabung")||
 text.includes("nabung")||
 text.includes("save")
 ){
   type="saving";
   category="saving";
 }
 else if(
 text.includes("gaji")||
 text.includes("bonus")||
 text.includes("masuk")
 ){
   type="income";
   category="salary";
 }
 else if(
 text.includes("uang makan")||
 text.includes("meal allowance")
 ){
   type="income";
   category="allowance";
 }

 else if(
text.includes("party") ||
text.includes("club") ||
text.includes("nongkrong") ||
text.includes("bar")
){
type="expense";
category="lifestyle";
}

else if(
text.includes("grab") ||
text.includes("taxi")
){
type="expense";
category="transport";
}

 else if(
 text.includes("makan")||
 text.includes("kopi")
 ){
   category="food";
 }

 return {
   amount,
   type,
   category
 }
}


// ================= ROOT =================
app.get("/",(req,res)=>{
 res.send("RantauFlow running");
});


// ================= REGISTER =================
app.post("/register",(req,res)=>{

const {email,password}=req.body;

if(!email || !password){
 return res.json({success:false});
}

db.run(
"INSERT INTO users(email,password) VALUES(?,?)",
[email,password],
function(err){

 if(err){
   console.log(err);
   return res.json({success:false});
 }

 res.json({
 success:true,
 userId:this.lastID
 });

});

});


// ================= LOGIN =================
app.post("/login",(req,res)=>{

const {email,password}=req.body;

db.get(
"SELECT * FROM users WHERE email=? AND password=?",
[email,password],
(err,row)=>{

if(err){
 console.log(err);
 return res.json({success:false});
}

if(!row){
 return res.json({success:false});
}

res.json({
success:true,
userId:row.id
});

});

});

// ================= CHAT SAVE =================
app.post("/chat",(req,res)=>{

const {message,userId}=req.body;

if(!userId){
 return res.json({message:"User belum login"});
}

const parsed=parseMessage(message);

if(!parsed.amount){
 return res.json({
 message:"Gue ga ngerti nominalnya bro 😅"
 });
}

const mealPraise=[
"🍜 Uang makan turun. Survival diperpanjang.",
"💰 Tunjangan masuk. Dompet dapet oksigen.",
"🥡 Perusahaan masih biayain lu makan."
];

if(parsed.category==="allowance"){

const pick=
mealPraise[
Math.floor(Math.random()*mealPraise.length)
];

return res.json({
message:
`${pick} Rp${parsed.amount.toLocaleString("id-ID")}`
});

}

// IMPORTANT FIXED INSERT

db.run(
"INSERT INTO transactions(user_id,amount,type,category) VALUES(?,?,?,?)",
[
userId,
parsed.amount,
parsed.type,
parsed.category
],
function(err){

if(err){
console.log('INSERT ERROR:',err);
return res.json({
message:"Error simpan data"
});
}

db.all(
"SELECT * FROM transactions WHERE user_id=?",
[userId],
(err,rows)=>{

if(err){
return res.json({
message:"Error baca data"
});
}

let expense=0;
let lifestyle=0;

rows.forEach(tx=>{

if(tx.type==="expense"){
expense+=tx.amount;
}

if(
tx.type==="expense" &&
tx.category==="lifestyle"
){
lifestyle+=tx.amount;
}

});

let warning="";

const roastPool=[
"💀 Lu bukan budgeting, lu sponsorship nightlife.",
"🍾 Duit lu kerja keras buat bartender.",
"🫠 Finansial lu lagi ikut afterparty.",
"🔥 Dompet lu party lebih keras dari lu."
];

if(
parsed.type==="expense" &&
expense>0 &&
(lifestyle/expense)>.25
){
warning=
roastPool[
Math.floor(Math.random()*roastPool.length)
];
}

const label=parsed.category;

res.json({
message:
`Tercatat ${label} Rp${parsed.amount.toLocaleString("id-ID")} ${warning}`
});

}
);

});

});


// ================= CHAT AI =================
app.post("/chat-ai",(req,res)=>{

const {message}=req.body;
const text=(message||"").toLowerCase();

db.all(
"SELECT * FROM transactions",
[],
(err,rows)=>{

let income=0;
let expense=0;
let lifestyle=0;

let categorySpend={};

rows.forEach(tx=>{

if(tx.type==="income"){
income+=tx.amount;
}

if(tx.type==="expense"){
expense+=tx.amount;

categorySpend[tx.category] =
(categorySpend[tx.category] || 0)+tx.amount;
}

});

let topCategory="other";
let biggest=0;

for(let cat in categorySpend){
if(categorySpend[cat] > biggest){
biggest=categorySpend[cat];
topCategory=cat;
}
}

let categoryAdvice="";

if(topCategory==="lifestyle"){
categoryAdvice=
"\n🍻 Pengeluaran nongkrong dominan.\nCoba atur budget mingguan buat hiburan.";
}

if(topCategory==="food"){
categoryAdvice=
"\n🍜 Makan nyedot cash.\nMeal prep lebih waras daripada delivery.";
}

if(topCategory==="transport"){
categoryAdvice=
"\n🚕 Transport bocor.\nBandingin Grab vs budget bulanan.";
}

if(topCategory==="shopping"){
categoryAdvice=
"\n🛍 Belanja impulsif dominan.\nPakai aturan 24 jam sebelum checkout.";
}

if(text.includes("roast")){

const roasts=[
"💀 Dompet lu kerja rodi buat nongkrong.",
"🍻 Cashflow lu lebih liar dari weekend.",
"🔥 Budget lu bukan budget, ini improv comedy.",
"☠ Pengeluaran lu hobi speedrun miskin."
];

return res.json({
reply:roasts[
Math.floor(Math.random()*roasts.length)
]
});

}

const balance=income-expense;

if(text.includes('duit')||text.includes('keuangan')){

if(balance<0){

reply=
`💀 Lu nombok hidup.

Fix cepat:
• Stop nongkrong 2 minggu
• Pangkas lifestyle 30%
• Prioritas cash buffer dulu

Target:
Sisa saldo minimal 20% tiap gajian.`;
}

else if(expense>income*0.8){

reply=
`⚠ Cash sisa Rp${balance.toLocaleString("id-ID")}

Problem:
Lifestyle makan ${Math.round((expense/income)*100)}% income.

Saran gue:
• Limit nongkrong max 10% gaji
• Pisahin tabungan otomatis awal bulan
• Uang makan + transport kasih ceiling

Kalau disiplin, health score lu bisa naik.
${categoryAdvice}`;
}

else if(expense>income*0.6){

reply=
`🟡 Cashflow lumayan aman.

Masih bisa dioptimalkan:
• Naikin saving rate
• Tekan expense impulsif
• Mulai emergency fund 3x biaya hidup`;
}

else{

reply=
`🔥 Cashflow aman bro.

Bahkan sekarang lu bisa:
• Push investasi
• Bangun emergency fund
• Scale tabungan jadi aset`;
}
return res.json({reply});

}

res.json({reply:'Ngomong yang jelas bro 😅'});

});

});


// ================= SUMMARY =================
app.get('/summary',(req,res)=>{

db.all(
'SELECT * FROM transactions',

[],
(err,rows)=>{

if(err){
return res.json({error:err.message});
}

let income = 0;
let expense = 0;
let categorySpend = {};
let weeklySpend = 0;

const now = Date.now();
const oneWeek = 7 * 24 * 60 * 60 * 1000;

rows.forEach(tx=>{

  if(tx.type === "income"){
    income += tx.amount;
  }

  if(tx.type === "expense"){
    expense += tx.amount;

    // category tracking
    const cat = (tx.category || "other").toLowerCase();

    categorySpend[cat] =
    (categorySpend[cat] || 0) + tx.amount;

    // weekly tracking
    if(tx.created_at){
  const txTime = new Date(tx.created_at).getTime();

  if(!isNaN(txTime) && (now - txTime) < oneWeek){
    weeklySpend += tx.amount;
  }
}
  }

});

const balance=income-expense;

// 👉 TAMBAH DI SINI
const recent = rows
.filter(tx => tx.type === "expense")
.slice(-5)
.reverse();

let score=100;

if(income>0){
 let ratio=expense/income;
 score=Math.round(
 100-(ratio*80)
 );
}


// ========= recurring detector =========

let recurring = [];

for(let cat in categorySpend){

  if(income > 0 && categorySpend[cat] > income * 0.20){

    recurring.push(
      `⚠️ ${cat} makan ${Math.round((categorySpend[cat]/income)*100)}% income`
    );

  }

}


// ========= response =========

res.json({
  transactions:rows,
  income,
  expense,
  balance,
  healthScore:score,
  recurring,

  // tambahan baru
  recent,
  weeklySpend
});

});

});


app.get('/top-category',(req,res)=>{

 db.get(`
 SELECT category,SUM(amount) total
 FROM transactions
 WHERE type='expense'
 GROUP BY category
 ORDER BY total DESC
 LIMIT 1
 `,[],(err,row)=>{

 res.json({
 category:row?.category||'other',
 total:row?.total||0
 });

 });

});

app.get("/summary/category",(req,res)=>{

db.all(
`
SELECT category,
SUM(amount) as total
FROM transactions
WHERE type='expense'
GROUP BY category
`,
[],
(err,rows)=>{
if(err){
return res.json({data:[]});
}

res.json({
data:rows
});

});

});

app.get("/insight",(req,res)=>{

db.get(`
SELECT
SUM(CASE WHEN type='income' THEN amount ELSE 0 END) as income,
SUM(CASE WHEN type='expense' THEN amount ELSE 0 END) as expense
FROM transactions
`,[],(err,row)=>{

const income=row.income||0;
const expense=row.expense||0;
const balance=income-expense;

db.all(
"SELECT category,SUM(amount) total FROM transactions WHERE type='expense' GROUP BY category",
[],
(err,rows)=>{

let categoryMap={};

rows.forEach(x=>{
categoryMap[x.category]=x.total;
});

let topCategory="other";
let max=0;

for(let cat in categoryMap){
if(categoryMap[cat]>max){
max=categoryMap[cat];
topCategory=cat;
}
}

let persen=expense>0?(max/expense)*100:0;

let insight=[];

if(balance<0){
insight.push("🚨 Cashflow negatif");
}

if(expense>income*0.85){
insight.push("💀 Duit hampir habis");
}

else if(expense>income*0.7){
insight.push("⚠ Expense lewat 70%");
}

if(topCategory==="lifestyle" && persen>40){
insight.push("🍾 Inget, lu nongkrong makan budget");
}

if(insight.length===0){
insight.push("✅ Stabil");
}

res.json({
income,
expense,
balance,
insight
});

});

});

});


// ================= SERVER =================
app.listen(3001,()=>{
  console.log("Server running on port 3001");
});