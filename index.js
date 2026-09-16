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

let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

let onboarding = {};
const bot = BOT_TOKEN? new Telegraf(BOT_TOKEN) : null;

// ===== FIX 3: WHATSAPP FORMATTER =====
function formatWhatsApp(num) {
  let n = num.replace(/[^0-9]/g, '');
  if (n.startsWith('0')) n = '234' + n.slice(1); // 080... -> 23480...
  if (n.length === 10) n = '234' + n; // 806... -> 234806...
  if (!n.startsWith('234')) n = '234' + n; // fallback
  return n;
}
function normalizeForCompare(num) {
  return num.replace(/[^0-9]/g, '').slice(-10); // last 10 digits for duplicate check
}

async function getVendor(telegram_id) {
  const { data } = await supabase.from('vendors').select('*').eq('telegram_id', String(telegram_id)).maybeSingle();
  return data || null;
}

// ===== FIX 1: DUPLICATE DETECTION FIXED =====
async function checkDuplicate(shop_name, whatsapp, current_id) {
  const { data: all } = await supabase.from('vendors').select('*');
  if (!all) return null;
  for (let v of all) {
    if (String(v.telegram_id) === String(current_id)) continue;
    if (shop_name) {
      if (v.shop_name && v.shop_name.trim().toLowerCase() === shop_name.trim().toLowerCase()) {
        return { type: 'name' };
      }
    }
    if (whatsapp) {
      if (v.whatsapp && normalizeForCompare(v.whatsapp) === normalizeForCompare(whatsapp)) {
        return { type: 'whatsapp' };
      }
    }
  }
  return null;
}

async function createVendor(telegram_id, data = {}) {
  const idStr = String(telegram_id);
  let existing = await getVendor(idStr);

  // FIX 2: COUNTING - force count from raw_products length
  let count = existing?.product_count || 0;
  if (data.product_count!== undefined) count = data.product_count;
  if (data.raw_products) count = data.raw_products.length;

  const vendor = {
    telegram_id: idStr,
    shop_name: data.shop_name || existing?.shop_name || null,
    whatsapp: data.whatsapp || existing?.whatsapp || null,
    category: data.category || existing?.category || null,
    plan: existing?.plan || 'free',
    product_count: count, // FIXED
    daily_visits: existing?.daily_visits || 0,
    last_visit_date: existing?.last_visit_date || new Date().toDateString(),
    status: 'approved',
    link_status: 'Active',
    created_at: existing?.created_at || new Date().toISOString()
  };
  await supabase.from('vendors').upsert(vendor, { onConflict: 'telegram_id' });
  if (data.raw_products) {
    await supabase.from('products').delete().eq('vendor_id', idStr);
    for (let p of data.raw_products) {
      let [name, price] = p.split('-').map(s=>s?.trim());
      if (name) await supabase.from('products').insert({ vendor_id: idStr, name, price: price||'0' });
    }
  }
  return vendor;
}

if (bot) {
  bot.start(async (ctx) => {
    const id = String(ctx.from.id);
    const payload = ctx.startPayload;
    if (payload === 'vendor123') {
      onboarding[id] = { step: 'business_name', data: {} };
      return ctx.reply(`👋 Welcome to CityLords! 🎉\nWhat is your business name?`);
    }
    let vendor = await getVendor(id);
    if (!vendor) vendor = await createVendor(id);
    ctx.reply(`👋 Dashboard\nShop: ${vendor.shop_name || 'Not set'}\nProducts: ${vendor.product_count}\n/plan`);
  });

  bot.command('plan', async (ctx) => {
    const v = await getVendor(String(ctx.from.id));
    ctx.reply(`📊 Shop: ${v.shop_name}\nProducts: ${v.product_count}\nWhatsApp: ${v.whatsapp}`);
  });

  bot.on('text', async (ctx) => {
    const id = String(ctx.from.id);
    const text = ctx.message.text;
    if (text.startsWith('/')) return;
    if (!onboarding[id]) return;
    const state = onboarding[id];
    if (state.step === 'business_name') {
      const dup = await checkDuplicate(text, null, id);
      if (dup) return ctx.reply(`❌ Name "${text}" already taken! Choose different name:`);
      state.data.shop_name = text;
      state.step = 'whatsapp';
      return ctx.reply(`"${text}" ✅\nWhatsApp number? (e.g 080... )`);
    }
    if (state.step === 'whatsapp') {
      const dup = await checkDuplicate(null, text, id);
      if (dup) return ctx.reply(`❌ WhatsApp "${text}" already used! Use another number:`);
      state.data.whatsapp = text;
      state.step = 'category';
      return ctx.reply(`Category? Fashion / Electronics / Used Items / Phones / Shoes / Others`);
    }
    if (state.step === 'category') {
      state.data.category = text;
      state.step = 'products';
      state.data.products = [];
      return ctx.reply(`Category ${text} ✅\nAdd products like: Rice - 5000\nType DONE when finished`);
    }
    if (state.step === 'products') {
      if (text.toLowerCase() === 'done') {
        const finalData = {
          shop_name: state.data.shop_name,
          whatsapp: state.data.whatsapp,
          category: state.data.category,
          product_count: state.data.products.length,
          raw_products: state.data.products
        };
        await createVendor(id, finalData);
        // FIX 3: DIRECT WHATSAPP WITH COUNTRY CODE
        const waNumber = formatWhatsApp(state.data.whatsapp);
        const uniqueLink = `https://wa.me/${waNumber}?text=Hi%20${encodeURIComponent(state.data.shop_name)}%20I%20saw%20your%20store`;
        delete onboarding[id];
        return ctx.reply(`🎉 Store ready! Products: ${finalData.product_count} ✅\n\nYour customer link (goes DIRECT to WhatsApp):\n${uniqueLink}\n\nTest it - it will open WhatsApp directly now!`);
      } else {
        state.data.products.push(text);
        return ctx.reply(`Added ✅ (${state.data.products.length} total) - More or DONE`);
      }
    }
  });
}

app.get('/', (req,res)=>res.send('<h1>CityLords FIXED All 3 ✅</h1>'));
app.get('/admin', async (req,res)=>{
  if(String(req.query.admin)!==String(ADMIN_ID)) return res.send('Admin only');
  let vendors = (await supabase.from('vendors').select('*')).data || [];
  let html = `<h1>${vendors.length} Vendors</h1><table border=1><tr><th>Name</th><th>WhatsApp</th><th>Count</th><th>Link</th><th>Del</th></tr>`;
  vendors.forEach(v=>{
    const wa = formatWhatsApp(v.whatsapp||'');
    html+=`<tr><td>${v.shop_name}</td><td>${v.whatsapp}</td><td>${v.product_count}</td><td><a href="https://wa.me/${wa}" target="_blank">wa.me/${wa}</a></td><td><a href="/admin/delete?id=${v.telegram_id}&admin=${ADMIN_ID}">Delete</a></td></tr>`;
  });
  res.send(html+'</table>');
});
app.get('/admin/delete', async (req,res)=>{
  await supabase.from('vendors').delete().eq('telegram_id', req.query.id);
  await supabase.from('products').delete().eq('vendor_id', req.query.id);
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});
app.listen(PORT, ()=>{ console.log('Running'); if(bot) bot.launch(); });
