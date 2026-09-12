require('dotenv').config();
const express=require('express');
const path=require('path');
const fs=require('fs');
const cookieParser=require('cookie-parser');
const bcrypt=require('bcryptjs');
const jwt=require('jsonwebtoken');
const Database=require('better-sqlite3');

const app=express();
const PORT=Number(process.env.PORT||3000);
const JWT_SECRET=process.env.JWT_SECRET||'dev-secret-change-me';
const COOKIE_SECRET=process.env.COOKIE_SECRET||'dev-cookie-change-me';
const production=process.env.NODE_ENV==='production';

fs.mkdirSync(path.join(__dirname,'data'),{recursive:true});
const db=new Database(path.join(__dirname,'data','fable.db'));
db.pragma('foreign_keys=ON');
db.pragma('journal_mode=WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL,
 email TEXT UNIQUE NOT NULL COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 role TEXT NOT NULL DEFAULT 'customer',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS services(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 slug TEXT UNIQUE NOT NULL,
 name TEXT NOT NULL,
 description TEXT NOT NULL,
 price_from INTEGER NOT NULL,
 turnaround TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS orders(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT UNIQUE NOT NULL,
 user_id INTEGER NOT NULL,
 service_id INTEGER,
 service_name TEXT NOT NULL,
 name TEXT NOT NULL,
 email TEXT NOT NULL,
 budget TEXT DEFAULT '',
 details TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'Received',
 admin_note TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(service_id) REFERENCES services(id)
);
CREATE TABLE IF NOT EXISTS events(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 order_id INTEGER NOT NULL,
 status TEXT NOT NULL,
 note TEXT DEFAULT '',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE
);`);

const seed=[
 ['website','Website Development','Modern responsive websites, landing pages, client portals and dashboards.',1499,'2–7 days'],
 ['minecraft-server','Minecraft Server Development','Server setup, optimization, permissions, menus, ranks, lobbies and custom systems.',999,'2–10 days'],
 ['discord-bot','Discord Bot Development','Custom moderation, tickets, verification, logging, economy and automation bots.',999,'2–7 days'],
 ['plugin','Minecraft Plugin Development','Custom Paper/Spigot plugins, APIs and integrations for your exact server idea.',1499,'3–14 days'],
 ['resource-pack','Resource Pack / UI','Custom textures, models, UI and branding assets for Minecraft.',799,'2–7 days'],
 ['custom','Custom Project','A tailored build for ideas that do not fit one category.',999,'Custom']
];
if(!db.prepare('SELECT 1 FROM services LIMIT 1').get()){
 const q=db.prepare('INSERT INTO services(slug,name,description,price_from,turnaround) VALUES(?,?,?,?,?)');
 db.transaction(()=>seed.forEach(s=>q.run(...s)))();
}
if(process.env.ADMIN_EMAIL&&process.env.ADMIN_PASSWORD){
 const email=process.env.ADMIN_EMAIL.trim().toLowerCase();
 if(!db.prepare('SELECT id FROM users WHERE email=?').get(email)){
  db.prepare("INSERT INTO users(name,email,password_hash,role) VALUES(?,?,?,'admin')").run(process.env.ADMIN_NAME||'Fable Admin',email,bcrypt.hashSync(process.env.ADMIN_PASSWORD,12));
 }
}

app.use(express.json({limit:'100kb'}));
app.use(cookieParser(COOKIE_SECRET));
app.use(express.static(path.join(__dirname,'public')));

function issueToken(user){return jwt.sign({sub:user.id,role:user.role},JWT_SECRET,{expiresIn:'7d'});}
function session(res,user){res.cookie('fable_session',issueToken(user),{httpOnly:true,signed:true,sameSite:'lax',secure:production,path:'/',maxAge:7*24*60*60*1000});}
function auth(req,res,next){
 try{
  const raw=req.signedCookies.fable_session;if(!raw) throw 0;
  const p=jwt.verify(raw,JWT_SECRET);
  const user=db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(p.sub);
  if(!user) throw 0;
  req.user=user;next();
 }catch(e){res.status(401).json({error:'Please log in to continue.'});}
}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({error:'Admin access required.'});next();}
function validEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);}
function orderCode(){let c;do{c='FAB-'+Math.random().toString(36).slice(2,7).toUpperCase()+'-'+Math.floor(1000+Math.random()*9000)}while(db.prepare('SELECT 1 FROM orders WHERE code=?').get(c));return c;}
async function notifyDiscord(o,title='🛠️ New Fable Studio Order'){
 if(!process.env.DISCORD_WEBHOOK_URL)return;
 try{await fetch(process.env.DISCORD_WEBHOOK_URL,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'Fable Studio',embeds:[{title,color:0x9b59ff,fields:[
  {name:'Order',value:o.code||'—',inline:true},{name:'Service',value:o.service_name||'—',inline:true},{name:'Status',value:o.status||'Received',inline:true},{name:'Customer',value:`${o.name||'—'}\n${o.email||'—'}`,inline:true},{name:'Budget',value:o.budget||'Not specified',inline:true},{name:'Details',value:String(o.details||'').slice(0,900)}],footer:{text:'Fable Studio V2'},timestamp:new Date().toISOString()}]})})}catch(e){console.error('Discord webhook error:',e.message)}
}

app.get('/api/services',(req,res)=>res.json({services:db.prepare('SELECT id,slug,name,description,price_from,turnaround FROM services WHERE active=1 ORDER BY id').all()}));
app.post('/api/register',(req,res)=>{
 const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 if(name.length<2||name.length>60)return res.status(400).json({error:'Enter a valid name.'});
 if(!validEmail(email))return res.status(400).json({error:'Enter a valid email.'});
 if(password.length<8)return res.status(400).json({error:'Password must be at least 8 characters.'});
 try{const r=db.prepare('INSERT INTO users(name,email,password_hash) VALUES(?,?,?)').run(name,email,bcrypt.hashSync(password,12));const u=db.prepare('SELECT id,name,email,role,created_at FROM users WHERE id=?').get(r.lastInsertRowid);session(res,u);res.status(201).json({user:u});}
 catch(e){res.status(409).json({error:'That email is already registered.'});}
});
app.post('/api/login',(req,res)=>{
 const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
 const r=db.prepare('SELECT * FROM users WHERE email=?').get(email);
 if(!r||!bcrypt.compareSync(password,r.password_hash))return res.status(401).json({error:'Invalid email or password.'});
 const u={id:r.id,name:r.name,email:r.email,role:r.role,created_at:r.created_at};session(res,u);res.json({user:u});
});
app.post('/api/logout',(req,res)=>{res.clearCookie('fable_session',{httpOnly:true,signed:true,sameSite:'lax',secure:production,path:'/'});res.json({ok:true})});
app.get('/api/me',auth,(req,res)=>res.json({user:req.user}));

app.post('/api/orders',auth,async(req,res)=>{
 const slug=String(req.body.service||''),budget=String(req.body.budget||'').slice(0,100),details=String(req.body.details||'').trim().slice(0,5000);
 const s=db.prepare('SELECT * FROM services WHERE slug=? AND active=1').get(slug);
 if(!s)return res.status(400).json({error:'Choose a valid service.'});
 if(details.length<10)return res.status(400).json({error:'Please describe your project in at least 10 characters.'});
 const code=orderCode();
 const r=db.prepare('INSERT INTO orders(code,user_id,service_id,service_name,name,email,budget,details) VALUES(?,?,?,?,?,?,?,?)').run(code,req.user.id,s.id,s.name,req.user.name,req.user.email,budget,details);
 db.prepare('INSERT INTO events(order_id,status,note) VALUES(?,?,?)').run(r.lastInsertRowid,'Received','Order received by Fable Studio.');
 const o=db.prepare('SELECT * FROM orders WHERE id=?').get(r.lastInsertRowid);await notifyDiscord(o);res.status(201).json({order:o});
});
app.get('/api/orders',auth,(req,res)=>res.json({orders:db.prepare('SELECT id,code,service_name,budget,details,status,admin_note,created_at,updated_at FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id)}));
app.get('/api/orders/:code',auth,(req,res)=>{
 const o=db.prepare('SELECT * FROM orders WHERE code=? AND user_id=?').get(req.params.code,req.user.id);if(!o)return res.status(404).json({error:'Order not found.'});
 res.json({order:o,events:db.prepare('SELECT status,note,created_at FROM events WHERE order_id=? ORDER BY id').all(o.id)});
});

app.get('/api/admin/stats',auth,admin,(req,res)=>res.json({orders:db.prepare('SELECT COUNT(*) c FROM orders').get().c,received:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='Received'").get().c,progress:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='In Progress'").get().c,completed:db.prepare("SELECT COUNT(*) c FROM orders WHERE status='Completed'").get().c,users:db.prepare('SELECT COUNT(*) c FROM users').get().c}));
app.get('/api/admin/orders',auth,admin,(req,res)=>res.json({orders:db.prepare('SELECT * FROM orders ORDER BY id DESC').all()}));
app.patch('/api/admin/orders/:id',auth,admin,async(req,res)=>{
 const allowed=['Received','In Progress','Waiting for Client','Completed','Cancelled'];const status=String(req.body.status||''),note=String(req.body.note||'').slice(0,1000);if(!allowed.includes(status))return res.status(400).json({error:'Invalid status.'});
 const o=db.prepare('SELECT * FROM orders WHERE id=?').get(Number(req.params.id));if(!o)return res.status(404).json({error:'Order not found.'});
 db.prepare('UPDATE orders SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,note,o.id);db.prepare('INSERT INTO events(order_id,status,note) VALUES(?,?,?)').run(o.id,status,note||`Status changed to ${status}.`);
 const updated=db.prepare('SELECT * FROM orders WHERE id=?').get(o.id);await notifyDiscord(updated,'📌 Fable Studio Order Update');res.json({order:updated});
});
app.get('/api/admin/services',auth,admin,(req,res)=>res.json({services:db.prepare('SELECT * FROM services ORDER BY id').all()}));
app.patch('/api/admin/services/:id',auth,admin,(req,res)=>{const price=Math.floor(Number(req.body.price_from)),turn=String(req.body.turnaround||'Custom').slice(0,80),active=req.body.active?1:0;if(!Number.isFinite(price)||price<0)return res.status(400).json({error:'Invalid price.'});db.prepare('UPDATE services SET price_from=?,turnaround=?,active=? WHERE id=?').run(price,turn,active,Number(req.params.id));res.json({ok:true})});
app.get('/api/admin/users',auth,admin,(req,res)=>res.json({users:db.prepare('SELECT id,name,email,role,created_at FROM users ORDER BY id DESC').all()}));

app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`Fable Studio V2 running on http://localhost:${PORT}`));
