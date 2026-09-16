const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '8030671133';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

function normalizeWa(raw) {
  let d = String(raw).replace(/[^0-9]/g, '');
  if (d.startsWith('0')) d = '234' + d.slice(1);
  if (d.length === 10) d = '234' + d;
  return d;
}
function prettyWa(d) {
  if (!d) return '';
  return d.startsWith('234')? '+234 ' + d.slice(3,6) + ' ' + d.slice(6,9) + ' ' + d.slice(9) : '+' + d;
}
async function getSession(id) {
  const r = await supabase.from('onboarding_sessions').select('*').eq('telegram_id', String(id)).maybeSingle();
  return r.data;
}
async function setSession(id, step, dataObj) {
  await supabase.from('onboarding_sessions').upsert({ telegram_id: String(id), step, data: dataObj }, { onConflict: 'telegram_id' });
}
async function delSession(id) {
  await supabase.from('onboarding_sessions').delete().eq('telegram_id', String(id));
}
async function getVendor(id) {
  const r = await supabase.from('vendors').select('*').eq('telegram_id', String(id)).maybeSingle();
  return r.data;
}
async function createVendor(id, extra) {
  const exist = await getVendor(id);
  const count = extra.product_count!== undefined? extra.product_count : (exist? exist.product_count : 0);
  const vendor = {
    telegram_id: String(id),
    shop_name: extra.shop_name || (exist? exist.shop_name : null),
    whatsapp: extra.whatsapp? normalizeWa(extra.whatsapp) : (exist? exist.whatsapp : null),
    whatsapp_display: extra.whatsapp? prettyWa(normalizeWa(extra.whatsapp)) : (exist? exist.whatsapp_display : null),
    category: extra.category || (exist? exist.category : null),
    product_count: count,
    status: 'approved',
    created_at: exist? exist.created_at : new Date().toISOString()
  };
  await supabase.from('vendors').upsert(vendor, { onConflict: 'telegram_id' });
  if (extra.raw_products && extra.raw_products.length) {
    await supabase.from('products').delete().eq('vendor_id', String(id));
    for (let p of extra.raw_products) {
      let a = p.split('-');
      let name = a[0]? a[0].trim() : '';
      let price = a.slice(1).join('-').trim() || '0';
      if (name) await supabase.from('products').insert({ vendor_id: String(id), name, price });
    }
  }
  return vendor;
}

bot.start(async (ctx) => {
  const id = String(ctx.from.id);
  const payload = ctx.startPayload || '';
  console.log('START', id, payload);
  if (payload.includes('vendor123') || ctx.message.text.includes('vendor123')) {
    await setSession(id, 'business_name', { products: [] });
    return ctx.reply('Welcome to CityLords! What is your business name?');
  }
  const vendor = await getVendor(id);
  if (!vendor) {
    await setSession(id, 'business_name', { products: [] });
    return ctx.reply('Welcome to CityLords! What is your business name?');
  }
  return ctx.reply(`Dashboard - Shop: ${vendor.shop_name} Products: ${vendor.product_count} Link: https://api.whatsapp.com/send?phone=${vendor.whatsapp}`);
});

bot.command('vendor123', async (ctx) => {
  await setSession(String(ctx.from.id), 'business_name', { products: [] });
  return ctx.reply('Welcome to CityLords! What is your business name?');
});

bot.on('text', async (ctx) => {
  const id = String(ctx.from.id);
  const text = ctx.message.text.trim();
  if (text.startsWith('/start') || text.startsWith('/vendor123')) return;
  let sess = await getSession(id);
  if (!sess) {
    await setSession(id, 'whatsapp', { shop_name: text, products: [] });
    return ctx.reply(`Got "${text}" ✅ WhatsApp? 080...`);
  }
  let data = sess.data || {};
  let step = sess.step;
  if (step === 'business_name') {
    data.shop_name = data.shop_name || text;
    await setSession(id, 'whatsapp', data);
    return ctx.reply(`Great "${data.shop_name}" ✅ WhatsApp? 08012345678`);
  }
  if (step === 'whatsapp') {
    data.whatsapp = normalizeWa(text);
    await setSession(id, 'category', data);
    return ctx.reply(`Number ${prettyWa(data.whatsapp)} ✅ Category?`);
  }
  if (step === 'category') {
    data.category = text;
    data.products = [];
    await setSession(id, 'products', data);
    return ctx.reply(`Category ${text} ✅ Add products: Rice - 5000 Type DONE`);
  }
  if (step === 'products') {
    if (text.toLowerCase() === 'done') {
      const count = (data.products || []).length;
      if (count === 0) return ctx.reply('Add 1 product first');
      await createVendor(id, { shop_name: data.shop_name, whatsapp: data.whatsapp, category: data.category, product_count: count, raw_products: data.products });
      await delSession(id);
      const link = 'https://api.whatsapp.com/send?phone=' + data.whatsapp;
      return ctx.reply(`Ready! Shop: ${data.shop_name} Products: ${count} Link: ${link} - This link ALWAYS opens WhatsApp direct`);
    } else {
      data.products = data.products || [];
      data.products.push(text);
      await setSession(id, 'products', data);
      return ctx.reply(`Added (${data.products.length}) More or DONE`);
    }
  }
});

app.get('/', (req, res) => res.send('CityLords LIVE'));
app.post('/webhook', (req, res) => bot.handleUpdate(req.body, res));
app.get('/store/:id', async (req, res) => {
  const v = await getVendor(req.params.id);
  if (!v) return res.send('Shop not found');
  return res.redirect('https://api.whatsapp.com/send?phone=' + v.whatsapp);
});
app.get('/admin', async (req, res) => {
  if (String(req.query.admin)!== String(ADMIN_ID)) return res.send('Admin only');
  const r = await supabase.from('vendors').select('*');
  let html = `<h1>${(r.data||[]).length} Vendors</h1><table border=1><tr><th>Shop</th><th>WhatsApp</th><th>Count</th><th>Link</th></tr>`;
  (r.data||[]).forEach(v => {
    html += `<tr><td>${v.shop_name}</td><td>${v.whatsapp}</td><td>${v.product_count}</td><td><a href="https://api.whatsapp.com/send?phone=${v.whatsapp}" target="_blank">Open WhatsApp</a></td></tr>`;
  });
  html += '</table>';
  res.send(html);
});

app.listen(PORT, async () => {
  console.log('CityLords Live ' + PORT);
  try {
    if (WEBHOOK_URL) {
      await bot.telegram.setWebhook(WEBHOOK_URL + '/webhook');
      console.log('Webhook set');
    } else {
      await bot.telegram.deleteWebhook();
      bot.launch({ dropPendingUpdates: true });
      console.log('Polling');
    }
  } catch (e) {
    console.log('Launch error ' + e.message);
  }
});
