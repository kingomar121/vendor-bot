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

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
let onboarding = {};
const bot = new Telegraf(BOT_TOKEN);

function formatWhatsApp(num) {
  if(!num) return '';
  let n = num.replace(/[^0-9]/g, '');
  if (n.startsWith('0')) n = '234' + n.slice(1);
  if (n.length === 10) n = '234' + n;
  if (!n.startsWith('234')) n = '234' + n;
  return n;
}

async function getVendor(id) {
  const { data } = await supabase.from('Vendors').select('*').eq('telegram_id', String(id)).maybeSingle();
  return data;
}

async function checkDuplicate(name, wa, curr) {
  const { data: all } = await supabase.from('Vendors').select('*');
  for (let v of all || []) {
    if (String(v.telegram_id) === String(curr)) continue;
    if (name && v.shop_name && v.shop_name.toLowerCase().trim() === name.toLowerCase().trim()) return 'name';
    if (wa && v.whatsapp) {
      if (v.whatsapp.replace(/\D/g,'').slice(-10) === wa.replace(/\D/g,'').slice(-10)) return 'whatsapp';
    }
  }
  return null;
}

async function saveVendor(id, data) {
  const count = data.raw_products? data.raw_products.length : 0;
  console.log('SAVING', id, 'COUNT', count);
  const row = {
    telegram_id: String(id),
    shop_name: data.shop_name,
    whatsapp: data.whatsapp,
    category: data.category,
    product_count: count,
    status: 'approved',
    link_status: 'Active'
  };
  const { error } = await supabase.from('Vendors').upsert(row, { onConflict: 'telegram_id' });
  if (error) console.error(error);

  if (data.raw_products) {
    await supabase.from('Products').delete().eq('vendor_id', String(id));
    for (let p of data.raw_products) {
      let [nm, pr] = p.split('-').map(s=>s.trim());
      if (nm) await supabase.from('Products').insert({ vendor_id: String(id), name: nm, price: pr||'0' });
    }
  }
}

bot.start(async (ctx) => {
  const id = String(ctx.from.id);
  if (ctx.startPayload === 'vendor123') {
    onboarding[id] = { step: 'name', data: { products: [] } };
    return ctx.reply('👋 Business name?');
  }
  const v = await getVendor(id);
  ctx.reply(`Dashboard: ${v?.shop_name} | Products: ${v?.product_count} | /plan`);
});

bot.command('plan', async (ctx) => {
  const v = await getVendor(ctx.from.id);
  ctx.reply(`Shop: ${v.shop_name}\nProducts: ${v.product_count}\nLink: https://wa.me/${formatWhatsApp(v.whatsapp)}`);
});

bot.on('text', async (ctx) => {
  const id = String(ctx.from.id);
  const txt = ctx.message.text;
  if (txt.startsWith('/')) return;
  if (!onboarding[id]) return;
  const s = onboarding[id];

  if (s.step === 'name') {
    const dup = await checkDuplicate(txt, null, id);
    if (dup) return ctx.reply(`❌ "${txt}" taken! Try another name:`);
    s.data.shop_name = txt;
    s.step = 'wa';
    return ctx.reply(`✅ ${txt}\nWhatsApp number? (080...)`);
  }
  if (s.step === 'wa') {
    const dup = await checkDuplicate(null, txt, id);
    if (dup) return ctx.reply(`❌ WhatsApp ${txt} already used! Use another:`);
    s.data.whatsapp = txt;
    s.step = 'cat';
    return ctx.reply('Category? (Fashion/Electronics/etc)');
  }
  if (s.step === 'cat') {
    s.data.category = txt;
    s.step = 'prod';
    return ctx.reply('Add products: Rice - 5000\nType DONE when finished');
  }
  if (s.step === 'prod') {
    if (txt.toLowerCase() === 'done') {
      await saveVendor(id, { shop_name: s.data.shop_name, whatsapp: s.data.whatsapp, category: s.data.category, raw_products: s.data.products });
      const wa = formatWhatsApp(s.data.whatsapp);
      delete onboarding[id];
      return ctx.reply(`🎉 READY! Products: ${s.data.products.length}\nCustomer link (direct WhatsApp):\nhttps://wa.me/${wa}?text=Hi%20${s.data.shop_name}\n\n/plan to check count`);
    } else {
      s.data.products.push(txt);
      return ctx.reply(`Added ${s.data.products.length} ✅ - more or DONE`);
    }
  }
});

app.get('/', (req,res)=>res.send('Live'));
app.get('/admin', async (req,res)=>{
  if(String(req.query.admin)!==String(ADMIN_ID)) return res.send('No');
  const { data } = await supabase.from('Vendors').select('*');
  let h = `<h1>${data.length} Vendors</h1><table border=1><tr><th>Name</th><th>WA</th><th>Count</th><th>Link</th><th>Del</th></tr>`;
  data.forEach(v=>{
    const wa = formatWhatsApp(v.whatsapp);
    h+=`<tr><td>${v.shop_name}</td><td>${v.whatsapp}</td><td>${v.product_count}</td><td><a href="https://wa.me/${wa}" target=_blank>wa.me/${wa}</a></td><td><a href="/admin/delete?id=${v.telegram_id}&admin=${ADMIN_ID}">Del</a></td></tr>`;
  });
  res.send(h+'</table>');
});
app.get('/admin/delete', async (req,res)=>{
  await supabase.from('Vendors').delete().eq('telegram_id', req.query.id);
  await supabase.from('Products').delete().eq('vendor_id', req.query.id);
  res.redirect(`/admin?admin=${ADMIN_ID}`);
});

app.listen(PORT, ()=>{ bot.launch(); console.log('Live on', PORT); });
