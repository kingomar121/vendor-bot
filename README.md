# CityLords Vendor Bot

Telegram Vendor Bot with Supabase

## Setup on Render

1. Go to render.com → New → Web Service
2. Connect your `vendor-bot` GitHub repo
3. Settings:
   - Build Command: `npm install`
   - Start Command: `npm start`
4. Add Environment Variables:

   BOT_TOKEN=8992764491:AAEApP039MVxGBnLFpLrKSUwq8mqpUQGwxU
   SUPABASE_URL=your_supabase_url_here
   SUPABASE_KEY=your_supabase_anon_key_here
   ADMIN_ID=8030671133
   NOWPAYMENTS_API_KEY=your_key
   NOWPAYMENTS_IPN_SECRET=your_secret
   PORT=3000

5. Deploy!

## Bot Commands
/start - Start bot
/register - Register shop
/shop - View shops
/admin - Admin panel
/approve ID - Approve vendor
