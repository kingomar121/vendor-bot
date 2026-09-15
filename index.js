const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// ENV - Will be set in Render
const BOT_TOKEN = process.env.BOT_TOKEN || '8992764491:AAEApP039MVxGBnLFpLrKSUwq8mqpUQGwxU';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID || '8030671133';
const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY;
const NOWPAYMENTS_IPN_SECRET = process.env.NOWPAYMENTS_IPN_SECRET;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.log('⚠️ Supabase not set yet - will use env on Render');
}

const supabase = SUPABASE_URL ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const bot = new Telegraf(BOT_TOKEN);

// Express for NOWPayments webhook
app.get('/', (req, res) => res.send('Vendor Bot Running ✅'));
app.post('/webhook/nowpayments', async (req, res) => {
  console.log('IPN:', req.body);
  // Verify & update payment status here
  res.sendStatus(200);
});

// START
bot.start(async (ctx) => {
  const userId = ctx.from.id.toString();
  const username = ctx.from.username || '';
  
  if (supabase) {
    await supabase.from('vendors').upsert({
      telegram_id: userId,
      username: username,
      last_seen: new Date().toISOString()
    }, { onConflict: 'telegram_id' });
  }

  await ctx.reply(
    `👑 Welcome to CityLords Vendor System\n\nID: ${userId}\nUse /register to become a vendor\nUse /shop to browse shops\nUse /admin if you are admin`,
    Markup.keyboard([['/register', '/shop'], ['/profile', '/help']]).resize()
  );
});

// REGISTER VENDOR
bot.command('register', async (ctx) => {
  await ctx.reply('🏪 Send your Shop Name:');
  bot.on('text', async (ctx2) => {
    if (ctx2.message.text.startsWith('/')) return;
    const shopName = ctx2.message.text;
    const userId = ctx2.from.id.toString();
    
    if (supabase) {
      const { error } = await supabase.from('vendors').upsert({
        telegram_id: userId,
        shop_name: shopName,
        username: ctx2.from.username,
        status: 'pending',
        created_at: new Date().toISOString()
      }, { onConflict: 'telegram_id' });
      
      if (error) return ctx2.reply('Error: ' + error.message);
    }
    
    await ctx2.reply(`✅ Shop "${shopName}" registered!\nWaiting for admin approval.\nAdmin ID: ${ADMIN_ID}`);
    try {
      await bot.telegram.sendMessage(ADMIN_ID, `🔔 New Vendor Request:\nShop: ${shopName}\nID: ${userId}\nUsername: @${ctx2.from.username}\n\n/approve ${userId}`);
    } catch(e){}
  });
});

// SHOP
bot.command('shop', async (ctx) => {
  if (!supabase) return ctx.reply('Supabase not connected yet');
  const { data } = await supabase.from('vendors').select('*').eq('status', 'approved');
  if (!data || data.length === 0) return ctx.reply('No shops yet');
  let msg = '🏬 Approved Shops:\n\n';
  data.forEach(v => { msg += `• ${v.shop_name} - @${v.username}\n`; });
  await ctx.reply(msg);
});

// ADMIN APPROVE
bot.command('approve', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return ctx.reply('Not admin');
  const idToApprove = ctx.message.text.split(' ')[1];
  if (!idToApprove) return ctx.reply('Usage: /approve TELEGRAM_ID');
  if (supabase) {
    await supabase.from('vendors').update({ status: 'approved' }).eq('telegram_id', idToApprove);
  }
  await ctx.reply(`✅ Approved ${idToApprove}`);
  try { await bot.telegram.sendMessage(idToApprove, '🎉 Your shop has been APPROVED! Use /shop'); } catch(e){}
});

bot.command('admin', (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return ctx.reply('Not admin');
  ctx.reply('👑 Admin Panel\n/approve ID - approve vendor\n/vendors - list vendors', Markup.keyboard([['/vendors']]).resize());
});

bot.command('vendors', async (ctx) => {
  if (ctx.from.id.toString() !== ADMIN_ID) return;
  if (!supabase) return ctx.reply('No DB');
  const { data } = await supabase.from('vendors').select('*');
  let msg = 'Vendors:\n';
  data?.forEach(v => msg += `${v.shop_name} | ${v.telegram_id} | ${v.status}\n`);
  ctx.reply(msg || 'None');
});

bot.command('profile', async (ctx) => {
  const userId = ctx.from.id.toString();
  if (!supabase) return ctx.reply(`ID: ${userId}`);
  const { data } = await supabase.from('vendors').select('*').eq('telegram_id', userId).single();
  if (!data) return ctx.reply('Not registered. Use /register');
  ctx.reply(`🏪 Shop: ${data.shop_name}\nStatus: ${data.status}\nID: ${data.telegram_id}`);
});

bot.command('help', (ctx) => {
  ctx.reply('/start - start\n/register - register shop\n/shop - view shops\n/profile - my shop\n/help - this');
});

bot.launch().then(() => console.log('Bot started'));
app.listen(process.env.PORT || 3000, () => console.log('Server running'));
