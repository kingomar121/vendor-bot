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
      onboarding[id] = { step: 'business_name', data: {} };
      return ctx.reply(`👋 Welcome to CityLords! 🎉\nWhat is your business name?`);
    }
    if (payload && payload!== 'vendor123') {
      // Customer should not even use this link again, but keep simple message
      return ctx.reply(`Please contact vendor directly on WhatsApp.`);
    }
    let vendor = await getVendor(id);
    if (!vendor) vendor = await createVendor(id);
    ctx.reply(`👋 Vendor Dashboard\nShop: ${vendor.shop_name || 'Not set'}\nProducts: ${vendor.product_count} (counting)\n/plan`);
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
      if (dup) return ctx.reply(`❌ Name "${text}" already taken. Choose another:`);
      state.data.shop_name = text;
      state.step = 'whatsapp';
      return ctx.reply(`Great! "${text}" ✅\nWhatsApp number?`);
    }
    if (state.step === 'whatsapp') {
      const dup = await checkDuplicate(null, text, id);
      if (dup) return ctx.reply(`❌ WhatsApp "${text}" already used. Use another:`);
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
        const waNumber = state.data.whatsapp.replace(/[^0-9]/g, '');
        const uniqueLink = `https://wa.me/${waNumber}?text=Hi%20${encodeURIComponent(state.data.shop_name)}%20I%20saw%20your%20store%20on%20CityLords`;
        delete onboarding[id];
        return ctx.reply(`🎉 Store ready! Products: ${finalData.product_count}\n\nYour DIRECT customer link:\n${uniqueLink}\n\nThis goes DIRECT to WhatsApp. No Telegram, no register message. Share it!`);
      } else {
        state.data.products.push(text);
        return ctx.reply(`Added ✅ (${state.data.products.length} total) - More or DONE`);
      }
    }
  });
}

app.get('/', (req,res)=>res.send('<h1>CityLords LIVE ✅ Direct WhatsApp Link</h1>'));
app.get('/admin', async (req,res)=>{
  if(String(req.query.admin)!==String(ADMIN_ID)) return res.send('Admin only');
  let vendors = (await supabase.from('vendors').select('*')).data || [];
  let html = `<h1>${vendors.length} Vendors</h1><table border=1><tr><th>Name</th><th>WhatsApp</th><th>Count</th><th>Direct Link</th><th>Del</th></tr>`;
  vendors.forEach(v=>{
    const wa = (v.whatsapp||'').replace(/[^0-9]/g,'');
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
