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

// Supabase Client
let supabase = null;
if (SUPABASE_URL && SUPABASE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  console.log('Supabase Connected');
} else {
  console.log('Supabase not set - using temporary memory');
}

// In-memory fallback
let vendorsMemory = {};

const bot = new Telegraf(BOT_TOKEN);

// ============ HELPER FUNCTIONS ============

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
    product_count: 0,
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
  if (!vendor) {
    vendor = await createVendor(telegram_id);
  }
  // Reset daily if new day
  const today = new Date().toDateString();
  if (vendor.last_visit_date !== today) {
    vendor.daily_visits = 0;
    vendor.last_visit_date = today;
  }
  
  // FREE = 10 DMs per day
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

// ============ BOT COMMANDS ============

bot.start(async (ctx) => {
  const id = String(ctx.from.id);
  let vendor = await getVendor(id);
  if (!vendor) vendor = await createVendor(id);
  
  ctx.reply(`👋 Welcome to CityLords Vendor Assistant!

PROJECT: Vendor Assistant

Your Shop: ${vendor.shop_name || 'Not set yet'}
Plan: ${vendor.plan.toUpperCase()} ${vendor.plan === 'free' ? '(10 DMs/day, 1 Product)' : '(Unlimited)'}

Commands:
/plan - Check your plan & upgrade
/addproduct - Add product with [+ Add Item] logic
/myproducts - View products
/admin - (Admin only) Generate vendor links

To register new vendor via link, ask Admin for link.`);
});

bot.command('plan', async (ctx) => {
  const vendor = await getVendor(String(ctx.from.id));
  if (!vendor) return ctx.reply('Send /start first');
  
  ctx.reply(`📊 YOUR PLAN

Shop: ${vendor.shop_name || 'Not set'}
Category: ${vendor.category || 'Not set'}
Plan: ${vendor.plan.toUpperCase()}
Products: ${vendor.product_count}/ ${vendor.plan === 'free' ? '1 (FREE)' : '20 (PAID)'}
DMs Today: ${vendor.daily_visits}/ ${vendor.plan === 'free' ? '10 (FREE)' : 'Unlimited (PAID)'}

FREE: 10 DMs/day, 1 Product
PAID: N2000/month - Unlimited DMs + 20 Products

To upgrade, contact Admin: @CityLords
Your ADMIN_ID: ${ctx.from.id}`, 
  { reply_markup: { inline_keyboard: [[{ text: 'Upgrade to PAID N2000', callback_data: 'upgrade' }]] } });
});

bot.command('addproduct', async (ctx) => {
  const vendor = await getVendor(String(ctx.from.id));
  if (!vendor) return ctx.reply('Send /start first');
  
  if (vendor.plan === 'free' && vendor.product_count >= 1) {
    return ctx.reply('⛔ FREE LIMIT: Only 1 product.\nUpgrade to PAID N2000 to add up to 20 products.\nSend /plan to upgrade.');
  }
  if (vendor.product_count >= 20) {
    return ctx.reply('⛔ MAX 20 products reached.');
  }
  
  ctx.reply(`➕ ADD ITEM (Button Logic)

Category: ${vendor.category || 'Not set - register first via link'}

Send product like this:
Name - Price
Example: Nike Air Max - 25000

For Fashion/Shoes: Add Color, Size with ticks
For Phones/Electronics: Add Brand/Model
For Used Items: Name + Price only

Max: ${vendor.plan === 'free' ? '1 (FREE)' : '20 (PAID)'}
Current: ${vendor.product_count}

Use [+ Add Item] in dashboard for better UX: /dashboard`);
});

bot.on('text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) return;
  
  const check = await checkAndUpdateLimit(String(ctx.from.id));
  if (!check.allowed) {
    return ctx.reply('⛔ FREE DAILY LIMIT REACHED: 10 DMs/day.\nYou have used 10/10 today.\n\nUpgrade to PAID N2000 for unlimited replies 24/7.\nSend /plan');
  }
  
  // Here you add AI auto-reply logic later
  // For now, just acknowledge
  ctx.reply(`✅ Auto-Reply (${check.vendor.daily_visits}/10 today)\n\nYou said: ${ctx.message.text}\n\n[Bot would reply to customer here 24/7]`);
});

// ============ EXPRESS ROUTES - ADMIN + VENDOR LINK SYSTEM ============

app.get('/', (req, res) => {
  res.send(`<h1>CityLords Vendor Assistant Live ✅</h1><p>Bot running</p><p>Admin: <a href="/admin?admin=${ADMIN_ID}">/admin?admin=${ADMIN_ID}</a></p>`);
});

// ADMIN PAGE - CityLords Admin Only
