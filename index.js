const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '8030671133';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 10000;

console.log('ENV CHECK:', {
  BOT_TOKEN: BOT_TOKEN? 'SET ✅' : 'MISSING ❌',
  ADMIN_ID: ADMIN_ID? 'SET ✅' : 'MISSING ❌',
  SUPABASE_URL: SUPABASE_URL? 'SET ✅' : 'MISSING ❌',
  SUPABASE_KEY: SUPABASE_KEY? 'SET ✅ length=' + SUPABASE_KEY.length : 'MISSING ❌'
});

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Supabase Connected ✅');
} else {
  console.log('Supabase not set - using temporary memory');
}

let vendorsMemory = {};
let onboarding = {}; // NEW: For vendor onboarding flow
const bot = BOT_TOKEN? new Telegraf(BOT_TOKEN) : null;

async function getVendor(telegram_id) {
  if (supabase) {
    const { data } = await supabase.from('vendors').select('*').eq('telegram_id', telegram_id).single();
    return data;
  } else {
    return vendorsMemory[telegram_id] || null;
  }
}

async function createVendor(telegram_id, data = {}) {
  const vendor = {
    telegram_id: String(telegram_id),
    shop_name: data.shop_name || null,
    whatsapp: data.whatsapp || null,
    category: data.category || null,
    plan: 'free',
    product_count: data.product_count || 0,
    daily_visits: 0,
    last_visit_date: new Date().toDateString(),
    status: 'approved',
    link_status: 'Active',
    delivery_fee: data.delivery_fee || null,
    account_no: data.account_no || null,
    created_at: new Date().toISOString()
  };
  if (supabase) {
    await supabase.from('vendors').upsert(vendor);
  } else {
    vendorsMemory[telegram_id] = vendor;
  }
  return vendor;
}

async function checkAndUpdateLimit(telegram_id) {
  let vendor = await getVendor(telegram_id);
  if (!vendor) vendor = await createVendor(telegram_id);
  const today = new Date().toDateString();
  if (vendor.last_visit_date!== today) {
    vendor.daily_visits = 0;
    vendor.last_visit_date = today;
  }
  if (vendor.plan === 'free' && vendor.daily_visits >= 10) {
    return { allowed: false, vendor };
  }
  vendor.daily_visits += 1;
  if (supabase) {
    await supabase.from('vendors').update({ daily_visits: vendor.daily_visits, last_visit_date: today }).eq('telegram_id', String(telegram_id));
  } else {
    vendorsMemory[telegram_id] = vendor;
  }
  return { allowed: true, vendor };
}

if (bot) {
  // ===== FIX 1: NEW bot.start WITH PAYLOAD HANDLING =====
  bot.start(async (ctx) => {
    const id = String(ctx.from.id);
    const payload = ctx.startPayload; // Gets vendor123 from link
    console.log('Start payload:', payload, 'from', id);

    // Vendor clicked invite link https://t.me/CityLordsBot?start=vendor123
    if (payload === 'vendor123') {
      onboarding[id] = { step: 'business_name', data: {} };
      return ctx.reply(`👋 Welcome to CityLords! 🎉\n\nLet's create your store quickly.\n\nWhat is your business name?`);
    }

    // Customer clicked vendor unique link e.g?start=ShopName
    if (payload && payload!== 'vendor123') {
      return ctx.reply(`Welcome to ${payload} store! 🛒\nProducts loading soon...\n\nType /start to create your own store.`);
    }

    // Normal start
    let vendor = await getVendor(id);
    if (!vendor) vendor = await createVendor(id);
    ctx.reply(`👋 Welcome to CityLords Vendor Assistant!

Your Shop: ${vendor.shop_name || 'Not set yet'}
Plan: ${vendor.plan.toUpperCase()} ${vendor.plan === 'free'? '(10 DMs/day, 1 Product)' : '(Unlimited)'}

Commands:
/plan - Check your plan & upgrade
/addproduct - Add product with [+ Add Item] logic
/myproducts - View products`);
  });

  bot.command('plan', async (ctx) => {
    const vendor = await getVendor(String(ctx.from.id));
    if (!vendor) return ctx.reply('Send /start first');
    ctx.reply(`📊 YOUR PLAN

Shop: ${vendor.shop_name || 'Not set'}
Category: ${vendor.category || 'Not set'}
Plan: ${vendor.plan.toUpperCase()}
Products: ${vendor.product_count}/${vendor.plan === 'free'? '1 (FREE)' : '20 (PAID)'}
DMs Today: ${vendor.daily_visits}/${vendor.plan === 'free'? '10 (FREE)' : 'Unlimited (PAID)'}

FREE: 10 DMs/day, 1 Product
PAID: N2000/month - Unlimited DMs + 20 Products`);
  });

  bot.command('addproduct', async (ctx) => {
    const vendor = await getVendor(String(ctx.from.id));
    if (!vendor) return ctx.reply('Send /start first');
    if (vendor.plan === 'free' && vendor.product_count >= 1) {
      return ctx.reply('⛔ FREE LIMIT: Only 1 product. Upgrade to PAID N2000');
    }
    ctx.reply(`➕ Send product like: Name - Price\nExample: Nike Air Max - 25000`);
  });

  // ===== FIX 2 & 3: NEW bot.on text WITH FULL FLOW =====
  bot.on('text', async (ctx) => {
    const id = String(ctx.from.id);
    const text = ctx.message.text;
    if (text.startsWith('/')) return;

    // ONBOARDING FLOW FOR NEW VENDORS
    if (onboarding[id]) {
      const state = onboarding[id];

      if (state.step === 'business_name') {
        state.data.shop_name = text;
        state.step = 'whatsapp';
        return ctx.reply(`Great! "${text}" ✅\n\nWhat is your WhatsApp number?`);
      }

      if (state.step === 'whatsapp') {
        state.data.whatsapp = text;
        state.step = 'category';
        return ctx.reply(`Thanks!\n\nWhat is your category?\nOptions: Fashion / Electronics / Used Items / Phones / Shoes / Others`);
      }

      if (state.step === 'category') {
        state.data.category = text;
        state.step = 'products';
        state.data.products = [];
        return ctx.reply(`Perfect! Category: ${text} ✅\n\nNow add your products and price\n\nFormat:\nRice - 5000\nShoes - 12000\n\nType DONE when finished`);
      }

      if (state.step === 'products') {
        if (text.toLowerCase() === 'done') {
          // Save to Supabase
          const finalData = {
            shop_name: state.data.shop_name,
            whatsapp: state.data.whatsapp,
            category: state.data.category,
            product_count: state.data.products.length || 1,
            raw_products: state.data.products
          };
          await createVendor(id, finalData);

          const cleanName = state.data.shop_name.replace(/\s+/g, '');
          const uniqueLink = `https://t.me/${ctx.botInfo.username}?start=${cleanName}`;

          delete onboarding[id];
          return ctx.reply(`🎉 Your store is ready!\n\nShop: ${finalData.shop_name}\nCategory: ${finalData.category}\nProducts: ${finalData.product_count}\n\nYour unique customer link:\n${uniqueLink}\n\nShare it with customers! They will see your products.\n\nSend /plan to manage.`);
        } else {
          state.data.products.push(text);
          return ctx.reply(`Added ✅ (${state.data.products.length} products) - Add more or type DONE`);
        }
      }
    }

    // NORMAL AUTO-REPLY LOGIC (for existing vendors)
    const check = await checkAndUpdateLimit(id);
    if (!check.allowed) {
      return ctx.reply('⛔ FREE DAILY LIMIT: 10/10 today. Upgrade to PAID N2000 for unlimited.');
    }
    ctx.reply(`✅ Auto-Reply (${check.vendor.daily_visits}/10 today)\nYou said: ${text}`);
  });
}

app.get('/', (req, res) => {
  res.send(`<h1>CityLords Vendor Assistant Live ✅</h1><p>Admin: <a href="/admin?admin=${ADMIN_ID}">/admin?admin=${ADMIN_ID}</a></p><p>ENV: BOT ${BOT_TOKEN? 'SET' : 'MISSING'} | SUPABASE ${supabase? 'CONNECTED' : 'TEMP MEMORY'}</p>`);
});

app.get('/admin', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) {
    return res.send(`<h2>Admin Only</h2><p>Add?admin=${ADMIN_ID} to URL</p>`);
  }
  let vendors = [];
  if (supabase) {
    const { data } = await supabase.from('vendors').select('*').order('created_at', { ascending: false });
    vendors = data || [];
  } else {
    vendors = Object.values(vendorsMemory);
  }
  let html = `<html><head><style>body{font-family:Arial;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px}button{padding:10px 15px;background:#000;color:#fff;border:none;cursor:pointer;margin:2px}.suspend{background:orange}.delete{background:red}.unsuspend{background:green}</style></head><body>
  <h1>CityLords Admin - Vendor Assistant powered by CityLords</h1>
  <a href="/admin/generate?admin=${ADMIN_ID}"><button>+ Generate Vendor Link</button></a><br><br>
  <table><tr><th>Vendor Name</th><th>Category</th><th>WhatsApp</th><th>Status</th><th>Plan</th><th>Action</th></tr>`;
  vendors.forEach(v => {
    html += `<tr>
      <td>${v.shop_name || v.telegram_id}</td>
      <td>${v.category || '-'}</td>
      <td>${v.whatsapp || ''}</td>
      <td>${v.status || 'approved'} / ${v.link_status || 'Active'}</td>
      <td>${v.plan}</td>
      <td>
        <a href="/dashboard/${v.telegram_id}"><button>View</button></a>
        <a href="/admin/suspend?id=${v.telegram_id}&admin=${ADMIN_ID}"><button class="suspend">Suspend</button></a>
        <a href="/admin/unsuspend?id=${v.telegram_id}&admin=${ADMIN_ID}"><button class="unsuspend">Unsuspend</button></a>
        <a href="/admin/delete?id=${v.telegram_id}&admin=${ADMIN_ID}"><button class="delete">Delete</button></a>
      </td>
    </tr>`;
  });
  html += `</table><br><p>Total Vendors: ${vendors.length}</p></body></html>`;
  res.send(html);
});

app.get('/admin/generate', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  const token = 'vendor123';
  const botUsername = bot? (await bot.telegram.getMe()).username : 'CityLordsBot';
  const link = `https://t.me/${botUsername}?start=${token}`;
  res.send(`<html><body style="font-family:Arial;padding:30px"><h2>✅ Link Generated!</h2><div style="background:#f5f5f5;padding:15px;border:1px dashed #000;word-break:break-all"><b>${link}</b></div><br><p>Send this ONE link to all vendors on TikTok/WhatsApp</p><p>When they click, bot will auto-ask business name -> WhatsApp -> Category -> Products -> Generate unique link</p><br><a href="/admin?admin=${ADMIN_ID}"><button>Back to Admin</button></a> <a href="${link}" target="_blank"><button style="background:green">Test Link</button></a></body></html>`);
});

app.get('/admin/disable', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  const id = req.query.id;
  if (supabase) {
    await supabase.from('vendors').update({ status: 'disabled', link_status: 'Disabled' }).eq('telegram_id', id);
  } else {
    if (vendorsMemory[id]) vendorsMemory[id].link_status = 'Disabled';
  }
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});

// NEW ADMIN ACTIONS YOU ASKED FOR
app.get('/admin/suspend', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  const id = req.query.id;
  if (supabase) {
    await supabase.from('vendors').update({ status: 'suspended', link_status: 'Suspended' }).eq('telegram_id', id);
  } else {
    if (vendorsMemory[id]) { vendorsMemory[id].status = 'suspended'; vendorsMemory[id].link_status = 'Suspended'; }
  }
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});

app.get('/admin/unsuspend', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  const id = req.query.id;
  if (supabase) {
    await supabase.from('vendors').update({ status: 'approved', link_status: 'Active' }).eq('telegram_id', id);
  } else {
    if (vendorsMemory[id]) { vendorsMemory[id].status = 'approved'; vendorsMemory[id].link_status = 'Active'; }
  }
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});

app.get('/admin/delete', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  const id = req.query.id;
  if (supabase) {
    await supabase.from('vendors').delete().eq('telegram_id', id);
  } else {
    delete vendorsMemory[id];
  }
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});

app.get('/register/:token', async (req, res) => {
  const token = req.params.token;
  res.send(`<html><head><style>body{font-family:Arial;max-width:600px;margin:20px auto;padding:20px}input{padding:8px;margin:5px}.item-box{border:1px solid #ddd;padding:10px;margin:5px 0}button{padding:8px 12px;margin:5px;cursor:pointer}.add-btn{background:#000;color:#fff;border:none}</style></head><body>
  <h1>Vendor Registration</h1><p>Link: ${token}</p>
  <form action="/register/${token}/submit" method="POST">
    <h3>Step 1: Business Name + WhatsApp</h3>
    Business Name: <input name="business_name" required><br>WhatsApp: <input name="whatsapp" required><br>
    <h3>Step 2: Choose ONE of 6 Categories</h3>
    <label><input type="radio" name="category" value="Fashion" required> Fashion</label><br>
    <label><input type="radio" name="category" value="Electronics"> Electronics</label><br>
    <label><input type="radio" name="category" value="Used Items"> Used Items [ + Add Item ]</label><br>
    <label><input type="radio" name="category" value="Phones"> Phones</label><br>
    <label><input type="radio" name="category" value="Shoes"> Shoes</label><br>
    <label><input type="radio" name="category" value="Others"> Others</label><br>
    <h3>Step 3: Products - [+ Add Item] logic (Max 20, FREE=1)</h3>
    <div id="items"><div class="item-box">Item 1: Name <input name="item1_name" placeholder="Product name"> Price <input name="item1_price" placeholder="N20000"></div></div>
    <button type="button" class="add-btn" onclick="addItem()">+ Add Item</button>
    <h3>Step 4: Delivery Fee + Account Number</h3>
    Delivery Fee: <input name="delivery_fee" placeholder="2000"><br>Account Number: <input name="account_no" placeholder="Bank - 0123456789"><br><br>
    <button type="submit" style="background:green;color:white;padding:12px 20px;border:none;width:100%">Done -> Open Dashboard</button>
  </form>
  <script>let count=1;function addItem(){if(count>=20){alert('Max 20');return;}count++;const div=document.createElement('div');div.className='item-box';div.innerHTML='Item '+count+': Name <input name="item'+count+'_name"> Price <input name="item'+count+'_price"> <button type="button" onclick="this.parentElement.remove();count--;">x remove</button>';document.getElementById('items').appendChild(div);}</script>
  </body></html>`);
});

app.post('/register/:token/submit', async (req, res) => {
  const token = req.params.token;
  const data = req.body;
  const vendorData = {
    telegram_id: token,
    shop_name: data.business_name,
    whatsapp: data.whatsapp,
    category: data.category,
    plan: 'free',
    product_count: Object.keys(data).filter(k => k.includes('_name') && data[k]).length || 1,
    daily_visits: 0,
    last_visit_date: new Date().toDateString(),
    status: 'approved',
    link_status: 'Active',
    delivery_fee: data.delivery_fee,
    account_no: data.account_no,
    created_at: new Date().toISOString(),
    raw_products: JSON.stringify(data)
  };
  if (supabase) {
    await supabase.from('vendors').upsert(vendorData);
  } else {
    vendorsMemory[token] = vendorData;
  }
  res.send(`<html><body style="font-family:Arial;padding:30px;text-align:center"><h1>✅ Registration Complete!</h1><p>Shop: ${data.business_name}</p><p>Category: ${data.category}</p><p>Plan: FREE (10 DMs/day, 1 Product)</p><br><a href="/dashboard/${token}"><button style="padding:12px 20px;background:#000;color:#fff;border:none">Go to Dashboard</button></a></body></html>`);
});

app.get('/dashboard/:id', async (req, res) => {
  const id = req.params.id;
  let vendor = null;
  if (supabase) {
    const { data } = await supabase.from('vendors').select('*').eq('telegram_id', id).single();
    vendor = data;
  } else {
    vendor = vendorsMemory[id];
  }
  if (!vendor) vendor = { telegram_id: id, shop_name: 'Vendor', plan: 'free', category: '-', product_count: 0, daily_visits: 0, link_status: 'Active' };
  res.send(`<html><body style="font-family:Arial;padding:20px;max-width:800px;margin:auto"><h1>Vendor Dashboard - ${vendor.shop_name || id}</h1><p>Category: ${vendor.category} | Plan: ${vendor.plan} | Products: ${vendor.product_count} | DMs Today: ${vendor.daily_visits}</p><h3>My Products (edit)</h3><p>Products saved with [+ Add Item] logic - Max 20</p><h3>My Chats (all DMs in one place)</h3><div style="border:1px solid #ccc;padding:10px;height:100px;background:#f9f9f9">No chats yet - Bot waiting</div><h3>Auto-Reply On/Off</h3><label><input type="checkbox" checked> Auto-Reply Enabled</label><h3>My Link Status</h3><p>${vendor.link_status || 'Active'}</p><a href="/admin?admin=${ADMIN_ID}">Admin</a></body></html>`);
});

app.listen(PORT, () => {
  console.log('Server running on port', PORT);
  if (bot) {
    bot.launch().then(() => console.log('Bot launched ✅')).catch(e => console.error('Bot launch error:', e.message));
  } else {
    console.log('BOT_TOKEN missing - Server running without Telegram bot (admin pages still work)');
  }
});

process.once('SIGINT', () => bot && bot.stop('SIGINT'));
process.once('SIGTERM', () => bot && bot.stop('SIGTERM'));
