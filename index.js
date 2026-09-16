const express = require('express');
const { Telegraf } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '8030671133';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || process.env.WEBHOOK_URL || '';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

// ===== CITYLORDS HELPERS =====
function normalizeWa(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/[^0-9]/g, '');
  if (d.startsWith('0')) d = '234' + d.slice(1);
  if (d.length === 10) d = '234' + d;
  return d;
}

function prettyWa(d) {
  if (!d) return '';
  if (d.startsWith('234')) {
    return '+234 ' + d.slice(3, 6) + ' ' + d.slice(6, 9) + ' ' + d.slice(9);
  }
  return '+' + d;
}

async function getSession(id) {
  const { data } = await supabase.from('onboarding_sessions').select('*').eq('telegram_id', String(id)).maybeSingle();
  return data;
}

async function setSession(id, step, dataObj) {
  await supabase.from('onboarding_sessions').upsert(
    { telegram_id: String(id), step: step, data: dataObj, updated_at: new Date().toISOString() },
    { onConflict: 'telegram_id' }
  );
}

async function delSession(id) {
  await supabase.from('onboarding_sessions').delete().eq('telegram_id', String(id));
}

async function getVendor(id) {
  const { data } = await supabase.from('vendors').select('*').eq('telegram_id', String(id)).maybeSingle();
  return data || null;
}

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

async function createVendor(id, extra = {}) {
  const exist = await getVendor(id);
  const count = extra.product_count!== undefined? extra.product_count : (exist? exist.product_count : 0);
  const vendor = {
    telegram_id: String(id),
    shop_name: extra.shop_name || (exist? exist.shop_name : null),
    whatsapp: extra.whatsapp? normalizeWa(extra.whatsapp) : (exist? exist.whatsapp : null),
    whatsapp_display: extra.whatsapp? prettyWa(normalizeWa(extra.whatsapp)) : (exist? exist.whatsapp_display : null),
    category: extra.category || (exist? exist.category : null),
    plan: exist? exist.plan : 'free',
    product_count: count,
    daily_visits: exist? exist.daily_visits : 0,
    last_visit_date: exist? exist.last_visit_date : new Date().toDateString(),
    status: 'approved',
    link_status: 'Active',
    created_at: exist? exist.created_at : new Date().toISOString()
  };
  await supabase.from('vendors').upsert(vendor, { onConflict: 'telegram_id' });
  if (extra.raw_products && extra.raw_products.length > 0) {
    await supabase.from('products').delete().eq('vendor_id', String(id));
    for (let p of extra.raw_products) {
      let parts = p.split('-');
      let name = parts[0]? parts[0].trim() : '';
      let price = parts.slice(1).join('-').trim() || '0';
      if (name) {
        await supabase.from('products').insert({ vendor_id: String(id), name: name, price: price });
      }
    }
  }
  return vendor;
}

// ===== BOT COMMANDS =====
bot.start(async (ctx) => {
  const id = String(ctx.from.id);
  const payload = ctx.startPayload || '';
  console.log('CITYLORDS START:', id, 'payload:', payload, 'text:', ctx.message.text);

  if (payload.includes('vendor123') || ctx.message.text.includes('vendor123')) {
    await setSession(id, 'business_name', { products: [] });
    return ctx.reply('👋 Welcome to CityLords! 🎉\nWhat is your business name?');
  }

  let vendor = await getVendor(id);
  if (!vendor) {
    await setSession(id, 'business_name', { products: [] });
    return ctx.reply('👋 Welcome to CityLords! 🎉\nWhat is your business name?');
  }

  return ctx.reply(`📊 CityLords Dashboard\nShop: ${vendor.shop_name}\nProducts: ${vendor.product_count} (endless ♾️)\nWhatsApp: ${vendor.whatsapp_display || vendor.whatsapp}\nYour Direct Link: https://api.whatsapp.com/send?phone=${vendor.whatsapp}\n\n/plan to view`);
});

bot.command('vendor123', async (ctx) => {
  const id = String(ctx.from.id);
  await setSession(id, 'business_name', { products: [] });
  return ctx.reply('👋 Welcome to CityLords! What is your business name?');
});

bot.command('plan', async (ctx) => {
  const id = String(ctx.from.id);
  const v = await getVendor(id);
  if (!v) return ctx.reply('No shop yet. Type /start vendor123');
  const directLink = `https://api.whatsapp.com/send?phone=${v.whatsapp}`;
  return ctx.reply(`📊 CityLords\nShop: ${v.shop_name}\nProducts: ${v.product_count}\nWhatsApp: ${v.whatsapp_display || v.whatsapp}\n\nCustomer Direct Link (Guaranteed to open):\n${directLink}`);
});

bot.on('text', async (ctx) => {
  const id = String(ctx.from.id);
  const text = ctx.message.text.trim();
  if (text.startsWith('/start') || text.startsWith('/plan') || text.startsWith('/vendor123')) return;

  console.log('CITYLORDS TEXT:', id, text);
  let sess = await getSession(id);
  if (!sess) {
    await setSession(id, 'business_name', { shop_name: text, products: [] });
    return ctx.reply(`Got business name "${text}" ✅\n\nWhatsApp number?\nPreset: +234 Nigeria\nJust type 08012345678`);
  }

  let data = sess.data || {};
  let step = sess.step;

  if (step === 'business_name') {
    const dup = await checkDuplicate(text, null, id);
    if (dup) return ctx.reply(`❌ Shop name "${text}" already exists as "${dup.existing}". Choose different:`);
    if (!data.shop_name) {
      data.shop_name = text;
    } else if (data.shop_name!== text) {
      const dup2 = await checkDuplicate(text, null, id);
      if (dup2) return ctx.reply(`❌ Shop name "${text}" already exists. Choose different:`);
      data.shop_name = text;
    }
    await setSession(id, 'whatsapp', data);
    return ctx.reply(`Great! "${data.shop_name}" ✅\n\nWhatsApp number?\nPreset +234 (Nigeria)\nType 08012345678`);
  }

  if (step === 'whatsapp') {
    if (text.replace(/[^0-9]/g, '').length < 10) return ctx.reply('❌ Too short. Type like 08012345678');
    const dup = await checkDuplicate(null, text, id);
    if (dup) return ctx.reply('❌ WhatsApp already used. Use another number:');
    data.whatsapp = normalizeWa(text);
    await setSession(id, 'category', data);
    return ctx.reply(`Number saved: ${prettyWa(data.whatsapp)} ✅\n\nCategory? Fashion / Electronics / Used Items / Phones / Shoes / Others`);
  }

  if (step === 'category') {
    data.category = text;
    data.products = data.products || [];
    await setSession(id, 'products', data);
    return ctx.reply(`Category ${text} ✅\n\nAdd products like:\nRice - 5000\nType DONE when finished`);
  }

  if (step === 'products') {
    if (text.toLowerCase() === 'done') {
      const exactCount = (data.products || []).length;
      if (exactCount === 0) {
        return ctx.reply('You added 0 products. Add at least 1 before DONE, e.g Rice - 5000');
      }
      const finalData = {
        shop_name: data.shop_name,
        whatsapp: data.whatsapp,
        category: data.category,
        product_count: exactCount,
        raw_products: data.products
      };
      await createVendor(id, finalData);
      await delSession(id);
      const directLink = `https://api.whatsapp.com/send?phone=${finalData.whatsapp}&text=Hi%20${encodeURIComponent(finalData.shop_name)}%20I%20saw%20your%20store%20on%20CityLords`;
      const shortLink = `https://api.whatsapp.com/send?phone=${finalData.whatsapp}`;
      return ctx.reply(`🎉 CityLords Store Ready!\n\nShop: ${finalData.shop_name}\nProducts: ${exactCount} ✅ Endless count fixed\nWhatsApp: ${prettyWa(finalData.whatsapp)}\n\n✅ GUAR
