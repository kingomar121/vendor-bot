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

async function getVendor(telegram_id) {
  const { data } = await supabase.from('vendors').select('*').eq('telegram_id', String(telegram_id)).maybeSingle();
  return data || null;
}

async function checkDuplicate(shop_name, whatsapp, current_id) {
  if (shop_name) {
    const { data } = await supabase.from('vendors').select('*').ilike('shop_name', shop_name).limit(1);
    if (data && data[0] && String(data[0].telegram_id)!== String(current_id)) return { type: 'name' };
  }
  if (whatsapp) {
    const { data } = await supabase.from('vendors').select('*').eq('whatsapp', whatsapp).limit(1);
    if (data && data[0] && String(data[0].telegram_id)!== String(current_id)) return { type: 'whatsapp' };
  }
  return null;
}

async function createVendor(telegram_id, data = {}) {
  const idStr = String(telegram_id);
  let existing = await getVendor(idStr);
  const vendor = {
    telegram_id: idStr,
    shop_name: data.shop_name || existing?.shop_name || null,
    whatsapp: data.whatsapp || existing?.whatsapp || null,
    category: data.category || existing?.category || null,
    plan: existing?.plan || 'free',
    product_count: data.product_count!== undefined? data.product_count : (existing?.product_count || 0),
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

// FIX 4 & 9 - PRESET +234 FOR V1
function normalizeWa(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^0-9]/g, ''); // REMOVE + sign - fixes popup error
  if (d.startsWith('0')) d = '234' + d.slice(1); // 080 -> 23480
  if (d.length === 10) d = '234' + d; // 8012345678 -> 2348012345678
  if (d.length === 11 && d.startsWith('0')) d = '234' + d.slice(1);
  // final: must be 234 + 10 digits = 13 digits total for Nigeria
  return d;
}

function prettyWa(d) {
  if (d.startsWith('234')) return '+234 ' + d.slice(3,6) + ' ' + d.slice(6,9) + ' ' + d.slice(9);
  return '+' + d;
}

async function getVendor(telegram_id) {
  const { data } = await supabase.from('vendors').select('*').eq('telegram_id', String(telegram_id)).maybeSingle();
  return data || null;
}

// FIX 2 - DUPLICATE CASE-INSENSITIVE + WHATSAPP
async function checkDuplicate(shop_name, whatsapp, current_id) {
  const { data } = await supabase.from('vendors').select('*');
  if (!data) return null;
  if (shop_name) {
    const cleanName = shop_name.trim().toLowerCase();
    const found = data.find(v => v.shop_name && v.shop_name.trim().toLowerCase() === cleanName && String(v.telegram_id)!== String(current_id));
    if (found) return { type: 'name', existing: found.shop_name };
  }
  if (whatsapp) {
    const cleanWa = normalizeWa(whatsapp);
    const last10 = cleanWa.slice(-10);
    const found = data.find(v => {
      if (!v.whatsapp) return false;
      const vWa = normalizeWa(v.whatsapp);
      return vWa.slice(-10) === last10 && String(v.telegram_id)!== String(current_id);
    });
    if (found) return { type: 'whatsapp', existing: found.whatsapp };
  }
  return null;
}

async function createVendor(telegram_id, data = {}) {
  const idStr = String(telegram_id);
  let existing = await getVendor(idStr);

  // FIX 1 - ENDLESS COUNTING - EXACT COUNT
  const count = data.product_count!== undefined? data.product_count : (existing?.product_count || 0);

  const vendor = {
    telegram_id: idStr,
    shop_name: data.shop_name || existing?.shop_name || null,
    whatsapp: data.whatsapp? normalizeWa(data.whatsapp) : existing?.whatsapp || null,
    whatsapp_display: data.whatsapp? prettyWa(normalizeWa(data.whatsapp)) : existing?.whatsapp_display || null,
    category: data.category || existing?.category || null,
    plan: existing?.plan || 'free',
    product_count: count,
    daily_visits: existing?.daily_visits || 0,
    last_visit_date: existing?.last_visit_date || new Date().toDateString(),
    status: 'approved',
    link_status: 'Active',
    created_at: existing?.created_at || new Date().toISOString()
  };
  await supabase.from('vendors').upsert(vendor, { onConflict: 'telegram_id' });

  // FIX 7 - PRODUCT COUNT = 0 BUG - FORCE SAVE
  if (data.raw_products && data.raw_products.length > 0) {
    await supabase.from('products').delete().eq('vendor_id', idStr);
    for (let p of data.raw_products) {
      let parts = p.split('-');
      let name = parts[0]?.trim();
      let price = parts.slice(1).join('-').trim() || '0';
      if (name) {
        await supabase.from('products').insert({ vendor_id: idStr, name, price });
      }
    }
    console.log(`CITYLORDS SAVED: ${idStr} - ${data.raw_products.length} products - ${vendor.shop_name}`);
  }
  return vendor;
}

if (bot) {
  bot.start(async (ctx) => {
    const id = String(ctx.from.id);
    const payload = ctx.startPayload || '';
    if (payload === 'vendor123' || payload.includes('vendor123')) {
      onboarding[id] = { step: 'business_name', data: {} };
      return ctx.reply(`👋 Welcome to CityLords! 🎉\nWhat is your business name?`);
    }
    if (payload && payload!== 'vendor123') {
      return ctx.reply(`Please contact vendor directly on WhatsApp.`);
    }
    let vendor = await getVendor(id);
    if (!vendor) vendor = await createVendor(id);
    ctx.reply(`👋 CityLords Vendor Dashboard\nShop: ${vendor.shop_name || 'Not set'}\nProducts: ${vendor.product_count} (endless)\nLink: wa.me/${vendor.whatsapp || ''}\n/plan`);
  });

  bot.command('plan', async (ctx) => {
    const v = await getVendor(String(ctx.from.id));
    if (!v) return ctx.reply('No shop yet. Type /start');
    ctx.reply(`📊 CityLords\nShop: ${v.shop_name}\nProducts: ${v.product_count}\nWhatsApp: ${v.whatsapp_display || v.whatsapp}\nShort Link: https://wa.me/${v.whatsapp}`);
  });

  bot.on('text', async (ctx) => {
    const id = String(ctx.from.id);
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (!onboarding[id]) return;
    const state = onboarding[id];

    if (state.step === 'business_name') {
      const dup = await checkDuplicate(text, null, id);
      if (dup) return ctx.reply(`❌ Shop name "${text}" already exists as "${dup.existing}". Choose different name:`);
      state.data.shop_name = text;
      state.step = 'whatsapp';
      return ctx.reply(`Great! "${text}" ✅\n\nWhatsApp number?\nPreset: +234 (Nigeria)\nJust type: 08012345678\nI will convert to +234 801 234 5678 automatically`);
    }

    if (state.step === 'whatsapp') {
      if (text.replace(/[^0-9]/g,'').length < 10) return ctx.reply(`❌ Number too short. Type like 08012345678`);
      const dup = await checkDuplicate(null, text, id);
      if (dup) return ctx.reply(`❌ WhatsApp already used. Use another number:`);
      state.data.whatsapp = normalizeWa(text);
      state.step = 'category';
      return ctx.reply(`Number saved: ${prettyWa(state.data.whatsapp)} ✅\n\nCategory? Fashion / Electronics / Used Items / Phones / Shoes / Others`);
    }

    if (state.step === 'category') {
      state.data.category = text;
      state.step = 'products';
      state.data.products = [];
      return ctx.reply(`Category ${text} ✅\n\nAdd products like: Rice - 5000\nType DONE when finished`);
    }

    if (state.step === 'products') {
      if (text.toLowerCase() === 'done') {
        // FIX 1 & 7 - EXACT COUNT
        const exactCount = state.data.products.length;
        if (exactCount === 0) return ctx.reply(`You added 0 products. Add at least 1 or type DONE again to save empty.`);

        console.log(`CITYLORDS COUNT FIX: ${exactCount}`, state.data.products);

        const finalData = {
          shop_name: state.data.shop_name,
          whatsapp: state.data.whatsapp,
          category: state.data.category,
          product_count: exactCount, // FIX 1
          raw_products: state.data.products // FIX 7
        };
        await createVendor(id, finalData);

        // FIX 8 & 9 - SHORT LINK, NO + SIGN, NO LONG TEXT
        const waNumber = state.data.whatsapp; // already 234...
        const shortLink = `https://wa.me/${waNumber}`; // SHORT LINK FIX

        delete onboarding[id];
        return ctx.reply(`🎉 CityLords Store Ready!\n\nShop: ${finalData.shop_name}\nProducts: ${exactCount} ✅\nWhatsApp: ${prettyWa(waNumber)}\n\nYour SHORT Customer Link (Direct WhatsApp):\n${shortLink}\n\nShare it! Customers go DIRECT to WhatsApp.`);
      } else {
        state.data.products.push(text);
        return ctx.reply(`Added ✅ (${state.data.products.length} total) - More or DONE`);
      }
    }
  });
}

app.get('/', (req, res) => res.send('<h1>CityLords LIVE ✅ V1 Nigeria - Endless - Short Link</h1>'));

// DIRECT WHATSAPP REDIRECT FOR CUSTOMERS - FIX 5
app.get('/store/:id', async (req, res) => {
  const v = await getVendor(req.params.id);
  if (!v ||!v.whatsapp) return res.send('Shop not found');
  return res.redirect(`https://wa.me/${v.whatsapp}`);
});

app.get('/admin', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  let vendors = (await supabase.from('vendors').select('*')).data || [];
  let html = `<h1>${vendors.length} Vendors - CityLords V1 Nigeria</h1><table border=1><tr><th>Name</th><th>WhatsApp</th><th>Count</th><th>Short Link</th><th>Del</th></tr>`;
  vendors.forEach(v => {
    html += `<tr><td>${v.shop_name}</td><td>${v.whatsapp_display || v.whatsapp}</td><td>${v.product_count}</td><td><a href="https://wa.me/${v.whatsapp}" target="_blank">wa.me/${v.whatsapp}</a></td><td><a href="/admin/delete?id=${v.telegram_id}&admin=${ADMIN_ID}">Delete</a></td></tr>`;
  });
  res.send(html + '</table>');
});

app.get('/admin/delete', async (req, res) => {
  await supabase.from('vendors').delete().eq('telegram_id', req.query.id);
  await supabase.from('products').delete().eq('vendor_id', req.query.id);
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});

app.listen(PORT, () => { console.log('CityLords V1 Nigeria - All 9 Fixed'); if (bot) bot.launch(); });
