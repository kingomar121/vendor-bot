const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());

/* =========================================================
   ENVIRONMENT
========================================================= */

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || '8030671133';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const PORT = process.env.PORT || 10000;
const WEBHOOK_URL = process.env.RENDER_EXTERNAL_URL || '';

/* WhatsApp - kept ready, but not required for this test */
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CITYLORDS_WA = process.env.CITYLORDS_WA;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'citylords123';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new Telegraf(BOT_TOKEN);

/* =========================================================
   CONSTANTS
========================================================= */

const CATEGORIES = [
  'Electronics',
  'Fashion',
  'Used items',
  'Food and drinks',
  'Real Estates',
  'Services',
  'Others'
];

/*
  Telegram duplicate protection.

  This protects the current single Render instance from
  processing the same Telegram update more than once.

  It is intentionally limited in size so it doesn't grow forever.
*/
const processedTelegramUpdates = new Set();
const MAX_PROCESSED_UPDATES = 5000;


/* =========================================================
   BASIC HELPERS
========================================================= */

function rememberTelegramUpdate(updateId) {
  if (!updateId) return true;

  const key = String(updateId);

  if (processedTelegramUpdates.has(key)) {
    return false;
  }

  processedTelegramUpdates.add(key);

  if (processedTelegramUpdates.size > MAX_PROCESSED_UPDATES) {
    const first = processedTelegramUpdates.values().next().value;
    processedTelegramUpdates.delete(first);
  }

  return true;
}


/* =========================================================
   WHATSAPP NUMBER HELPERS
========================================================= */

function normalizeWa(raw) {
  let d = String(raw || '').replace(/[^0-9]/g, '');

  if (d.startsWith('0')) {
    d = '234' + d.slice(1);
  }

  if (d.length === 10) {
    d = '234' + d;
  }

  return d;
}


function prettyWa(d) {
  if (!d) return '';

  if (d.startsWith('234')) {
    return '+234 ' +
      d.slice(3, 6) + ' ' +
      d.slice(6, 9) + ' ' +
      d.slice(9);
  }

  return '+' + d;
}


/* =========================================================
   BUSINESS NAME NORMALIZATION
========================================================= */

function normalizeBusinessName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?]+$/g, '')
    .trim();
}


/* =========================================================
   SUPABASE - ONBOARDING SESSION
========================================================= */

async function getSession(id) {
  try {
    const r = await supabase
      .from('onboarding_sessions')
      .select('*')
      .eq('telegram_id', String(id))
      .maybeSingle();

    if (r.error) {
      console.log('getSession error:', r.error.message);
      return null;
    }

    return r.data;
  } catch (e) {
    console.log('getSession exception:', e.message);
    return null;
  }
}


async function setSession(id, step, dataObj) {
  try {
    const r = await supabase
      .from('onboarding_sessions')
      .upsert(
        {
          telegram_id: String(id),
          step,
          data: dataObj
        },
        {
          onConflict: 'telegram_id'
        }
      );

    if (r.error) {
      console.log('setSession error:', r.error.message);
    }

    return r;
  } catch (e) {
    console.log('setSession exception:', e.message);
    return null;
  }
}


async function delSession(id) {
  try {
    const r = await supabase
      .from('onboarding_sessions')
      .delete()
      .eq('telegram_id', String(id));

    if (r.error) {
      console.log('delSession error:', r.error.message);
    }

    return r;
  } catch (e) {
    console.log('delSession exception:', e.message);
    return null;
  }
}


/* =========================================================
   SUPABASE - VENDOR
========================================================= */

async function getVendor(id) {
  try {
    const r = await supabase
      .from('vendors')
      .select('*')
      .eq('telegram_id', String(id))
      .maybeSingle();

    if (r.error) {
      console.log('getVendor error:', r.error.message);
      return null;
    }

    return r.data;
  } catch (e) {
    console.log('getVendor exception:', e.message);
    return null;
  }
}


/*
  Finds an existing business by normalized name.

  For the current test version we fetch the vendor names and
  compare them in JavaScript. This is fine for testing and
  small numbers of vendors.

  Later, when CityLords grows, we should add a normalized-name
  database column/index for faster searching.
*/
async function getVendorByBusinessName(name) {
  const target = normalizeBusinessName(name);

  if (!target) return null;

  try {
    const r = await supabase
      .from('vendors')
      .select('*');

    if (r.error) {
      console.log(
        'getVendorByBusinessName error:',
        r.error.message
      );
      return null;
    }

    const vendors = r.data || [];

    for (const vendor of vendors) {
      if (
        normalizeBusinessName(vendor.shop_name) === target
      ) {
        return vendor;
      }
    }

    return null;
  } catch (e) {
    console.log(
      'getVendorByBusinessName exception:',
      e.message
    );
    return null;
  }
}


/* =========================================================
   CREATE / UPDATE VENDOR
========================================================= */

async function createVendor(id, extra) {
  const existing = await getVendor(id);

  const count =
    extra.product_count !== undefined
      ? extra.product_count
      : (existing ? existing.product_count : 0);

  const vendor = {
    telegram_id: String(id),

    shop_name:
      extra.shop_name ||
      (existing ? existing.shop_name : null),

    whatsapp:
      extra.whatsapp
        ? normalizeWa(extra.whatsapp)
        : (existing ? existing.whatsapp : null),

    whatsapp_display:
      extra.whatsapp
        ? prettyWa(normalizeWa(extra.whatsapp))
        : (existing ? existing.whatsapp_display : null),

    category:
      extra.category ||
      (existing ? existing.category : null),

    product_count: count,

    status: 'approved',

    created_at:
      existing
        ? existing.created_at
        : new Date().toISOString()
  };

  const result = await supabase
    .from('vendors')
    .upsert(
      vendor,
      {
        onConflict: 'telegram_id'
      }
    );

  if (result.error) {
    console.log(
      'createVendor error:',
      result.error.message
    );
    throw new Error(result.error.message);
  }

  /*
    Save products only when raw_products were supplied.
  */
  if (
    extra.raw_products &&
    extra.raw_products.length
  ) {
    await supabase
      .from('products')
      .delete()
      .eq('vendor_id', String(id));

    for (const p of extra.raw_products) {
      const parts = String(p).split('-');

      const productName =
        parts[0]
          ? parts[0].trim()
          : '';

      const price =
        parts
          .slice(1)
          .join('-')
          .trim() || '0';

      if (productName) {
        const productResult =
          await supabase
            .from('products')
            .insert({
              vendor_id: String(id),
              name: productName,
              price: price
            });

        if (productResult.error) {
          console.log(
            'Product insert error:',
            productResult.error.message
          );
        }
      }
    }
  }

  return vendor;
}


/* =========================================================
   TELEGRAM VENDOR MENU
========================================================= */

function vendorMenu() {
  return Markup.keyboard([
    ['🏪 Business Name', '📦 Products'],
    ['💰 Prices', '❓ FAQs'],
    ['🤖 Assistant Name', '📱 WhatsApp Number'],
    ['📝 Business Information', '🔗 My Store Link'],
    ['📊 Dashboard', '⚙️ Settings']
  ])
    .resize();
}


/* =========================================================
   EXISTING VENDOR HANDLER
========================================================= */

async function handleExistingVendor(ctx, vendor) {
  const shopName =
    vendor.shop_name || 'Your business';

  return ctx.reply(
    `Welcome back to CityLords! 🏙️\n\n` +
    `🏪 Business: ${shopName}\n\n` +
    `Your vendor account is already registered.\n` +
    `You do not need to register again.\n\n` +
    `What would you like to manage?`,
    vendorMenu()
  );
}


/* =========================================================
   START NEW REGISTRATION
========================================================= */

async function startRegistration(ctx) {
  const id = String(ctx.from.id);

  /*
    VERY IMPORTANT:
    Always check vendor first.

    This prevents an already registered vendor from
    accidentally entering registration again.
  */
  const existingVendor = await getVendor(id);

  if (existingVendor) {
    return handleExistingVendor(ctx, existingVendor);
  }

  /*
    If they have an existing onboarding session,
    continue it instead of starting from scratch.
  */
  const existingSession = await getSession(id);

  if (existingSession) {
    return ctx.reply(
      `Welcome back to CityLords! 🏙️\n\n` +
      `You already started registration.\n` +
      `Let's continue from where you stopped.`
    );
  }

  await setSession(
    id,
    'business_name',
    {
      products: []
    }
  );

  return ctx.reply(
    'Welcome to CityLords! 🏙️\n\n' +
    'What is your business name?'
  );
}


/* =========================================================
   TELEGRAM /START
========================================================= */

bot.start(async (ctx) => {
  try {
    return await startRegistration(ctx);
  } catch (e) {
    console.log('/start error:', e.message);

    return ctx.reply(
      'Sorry, something went wrong. Please try again.'
    );
  }
});


/* =========================================================
   TELEGRAM /VENDOR123
========================================================= */

bot.command('vendor123', async (ctx) => {
  try {
    return await startRegistration(ctx);
  } catch (e) {
    console.log('/vendor123 error:', e.message);

    return ctx.reply(
      'Sorry, something went wrong. Please try again.'
    );
  }
});


/* =========================================================
   TELEGRAM TEXT HANDLER
========================================================= */

bot.on('text', async (ctx) => {
  const id = String(ctx.from.id);
  const text = String(
    ctx.message.text || ''
  ).trim();

  if (!text) return;

  /*
    Commands are handled above.
  */
  if (text.startsWith('/')) {
    return;
  }

  try {

    /* =====================================================
       MOST IMPORTANT CHECK:
       EXISTING VENDOR ALWAYS COMES FIRST
    ===================================================== */

    const existingVendor = await getVendor(id);

    if (existingVendor) {
      /*
        Existing vendor does NOT enter registration.

        Later, the menu buttons will call the relevant
        editing functions.
      */
      return handleExistingVendor(
        ctx,
        existingVendor
      );
    }


    /* =====================================================
       NO VENDOR YET - CHECK ONBOARDING
    ===================================================== */

    let sess = await getSession(id);

    if (!sess) {
      await setSession(
        id,
        'business_name',
        {
          products: []
        }
      );

      return ctx.reply(
        'Welcome to CityLords! 🏙️\n\n' +
        'What is your business name?'
      );
    }


    let data = sess.data || {};
    const step = sess.step;


    /* =====================================================
       STEP 1 - BUSINESS NAME
    ===================================================== */

    if (step === 'business_name') {

      const proposedName = text;

      /*
        Check whether another vendor already uses this
        business name.
      */
      const existingBusiness =
        await getVendorByBusinessName(
          proposedName
        );

      if (existingBusiness) {

        /*
          If this Telegram ID somehow belongs to the same
          vendor, welcome them instead.
        */
        if (
          String(existingBusiness.telegram_id) === id
        ) {
          await delSession(id);

          return handleExistingVendor(
            ctx,
            existingBusiness
          );
        }

        return ctx.reply(
          `⚠️ The business name "${proposedName}" ` +
          `is already registered on CityLords.\n\n` +
          `Please enter a different business name.`
        );
      }

      data.shop_name = proposedName;

      await setSession(
        id,
        'whatsapp',
        data
      );

      return ctx.reply(
        `Great! "${data.shop_name}" ✅\n\n` +
        `What is your WhatsApp number?\n` +
        `Example: 08012345678`
      );
    }


    /* =====================================================
       STEP 2 - WHATSAPP
    ===================================================== */

    if (step === 'whatsapp') {

      const normalized = normalizeWa(text);

      if (
        !normalized ||
        normalized.length < 10
      ) {
        return ctx.reply(
          'Please enter a valid Nigerian WhatsApp number.\n\n' +
          'Example: 08012345678'
        );
      }

      data.whatsapp = normalized;

      await setSession(
        id,
        'category',
        data
      );

      return ctx.reply(
        `Number ${prettyWa(data.whatsapp)} ✅\n\n` +
        `Choose your category:`,
        Markup.keyboard(
          CATEGORIES.map(c => [c])
        )
          .oneTime()
          .resize()
      );
    }


    /* =====================================================
       STEP 3 - CATEGORY
    ===================================================== */

    if (step === 'category') {

      if (!CATEGORIES.includes(text)) {

        return ctx.reply(
          'Please choose from the list below:',
          Markup.keyboard(
            CATEGORIES.map(c => [c])
          )
            .oneTime()
            .resize()
        );
      }

      data.category = text;
      data.products = [];

      await setSession(
        id,
        'products',
        data
      );

      return ctx.reply(
        `Category: ${text} ✅\n\n` +
        `Now add your products with prices.\n\n` +
        `Format:\n` +
        `Product Name - Price\n\n` +
        `Example:\n` +
        `Rice - 5000\n\n` +
        `Send one product per message.\n` +
        `Type DONE when finished.`,
        Markup.removeKeyboard()
      );
    }


    /* =====================================================
       STEP 4 - PRODUCTS
    ===================================================== */

    if (step === 'products') {

      if (
        text.toLowerCase() === 'done'
      ) {

        const count =
          (data.products || []).length;

        if (count === 0) {
          return ctx.reply(
            'Please add at least 1 product first.\n\n' +
            'Example: Rice - 5000'
          );
        }

        /*
          Final duplicate protection:
          check Telegram ID again before creating vendor.
        */
        const vendorAlreadyExists =
          await getVendor(id);

        if (vendorAlreadyExists) {
          await delSession(id);

          return handleExistingVendor(
            ctx,
            vendorAlreadyExists
          );
        }

        /*
          Check business name one final time before
          creating the account.
        */
        const duplicateBusiness =
          await getVendorByBusinessName(
            data.shop_name
          );

        if (duplicateBusiness) {

          if (
            String(
              duplicateBusiness.telegram_id
            ) === id
          ) {
            await delSession(id);

            return handleExistingVendor(
              ctx,
              duplicateBusiness
            );
          }

          return ctx.reply(
            `⚠️ The business name "${data.shop_name}" ` +
            `has already been registered.\n\n` +
            `Please restart registration with a different name.`
          );
        }

        const vendor =
          await createVendor(
            id,
            {
              shop_name: data.shop_name,
              whatsapp: data.whatsapp,
              category: data.category,
              product_count: count,
              raw_products: data.products
            }
          );

        await delSession(id);

        const storeLink =
          `${WEBHOOK_URL}/store/${id}`;

        return ctx.reply(
          `🎉 CityLords registration complete!\n\n` +
          `🏪 Business: ${vendor.shop_name}\n` +
          `📂 Category: ${vendor.category}\n` +
          `📦 Products: ${count}\n\n` +
          `🔗 Your store link:\n` +
          `${storeLink}\n\n` +
          `You can return to CityLords anytime to manage your business.`,
          vendorMenu()
        );
      }


      /* Add product */

      data.products =
        data.products || [];

      data.products.push(text);

      await setSession(
        id,
        'products',
        data
      );

      return ctx.reply(
        `✅ Added: ${text}\n\n` +
        `Products added: ${data.products.length}\n\n` +
        `Send another product or type DONE.`
      );
    }


    /* =====================================================
       UNKNOWN SESSION STEP
    ===================================================== */

    await setSession(
      id,
      'business_name',
      {
        products: []
      }
    );

    return ctx.reply(
      'Let\'s restart your registration.\n\n' +
      'What is your business name?'
    );

  } catch (e) {

    console.log(
      'Telegram text handler error:',
      e
    );

    return ctx.reply(
      'Sorry, something went wrong while processing your message.\n\n' +
      'Please try again.'
    );
  }
});


/* =========================================================
   WHATSAPP SEND FUNCTION
   Kept ready for later Meta activation
========================================================= */

async function sendWhatsApp(to, message) {

  if (
    !WHATSAPP_TOKEN ||
    !PHONE_NUMBER_ID
  ) {
    console.log(
      'WhatsApp not configured yet.'
    );
    return;
  }

  try {

    const url =
      `https://graph.facebook.com/v20.0/` +
      `${PHONE_NUMBER_ID}/messages`;

    const res = await fetch(
      url,
      {
        method: 'POST',

        headers: {
          'Authorization':
            `Bearer ${WHATSAPP_TOKEN}`,

          'Content-Type':
            'application/json'
        },

        body: JSON.stringify({
          messaging_product: 'whatsapp',

          to: to,

          type: 'text',

          text: {
            body: message
          }
        })
      }
    );

    const data =
      await res.json();

    console.log(
      'WA sent:',
      data
    );

  } catch (e) {

    console.log(
      'WA error:',
      e.message
    );
  }
}


/* =========================================================
   EXPRESS
========================================================= */

app.get('/', (req, res) => {
  res.send('CityLords LIVE - TEST VERSION');
});


/* =========================================================
   TELEGRAM WEBHOOK
========================================================= */

app.post('/webhook', async (req, res) => {

  /*
    CRITICAL FIX:

    Telegram gets HTTP 200 immediately.

    This prevents Telegram from waiting for Supabase/Telegram
    processing and retrying the same update.
  */
  res.sendStatus(200);

  const update = req.body;

  /*
    Ignore duplicate Telegram updates.
  */
  if (
    update &&
    update.update_id !== undefined
  ) {

    const isNew =
      rememberTelegramUpdate(
        update.update_id
      );

    if (!isNew) {

      console.log(
        'Duplicate Telegram update ignored:',
        update.update_id
      );

      return;
    }
  }

  /*
    Process after acknowledging Telegram.
  */
  try {

    await bot.handleUpdate(update);

  } catch (e) {

    console.log(
      'Telegram webhook processing error:',
      e
    );
  }
});


/* =========================================================
   WHATSAPP WEBHOOK VERIFICATION
========================================================= */

app.get(
  '/whatsapp-webhook',
  (req, res) => {

    const mode =
      req.query['hub.mode'];

    const token =
      req.query['hub.verify_token'];

    const challenge =
      req.query['hub.challenge'];

    if (
      mode === 'subscribe' &&
      token === VERIFY_TOKEN
    ) {

      console.log(
        'WhatsApp webhook verified.'
      );

      return res
        .status(200)
        .send(challenge);
    }

    return res.sendStatus(403);
  }
);


/* =========================================================
   WHATSAPP WEBHOOK
   Ready for later Meta activation
========================================================= */

app.post(
  '/whatsapp-webhook',
  async (req, res) => {

    /*
      Acknowledge Meta immediately.
    */
    res.sendStatus(200);

    try {

      const body = req.body;

      if (
        !body ||
        body.object !== 'whatsapp_business_account'
      ) {
        return;
      }

      const entries =
        body.entry || [];

      for (const entry of entries) {

        const changes =
          entry.changes || [];

        for (const change of changes) {

          const value =
            change.value;

          if (!value) continue;

          const messages =
            value.messages || [];

          for (const message of messages) {

            const from =
              message.from;

            const text =
              message.text?.body || '';

            if (!from || !text) {
              continue;
            }

            console.log(
              'WhatsApp message:',
              from,
              text
            );


            /* ---------------------------------------------
               Vendor routing

               Supports the new CityLords marker:
               CL_VENDOR_123456

               Also supports the old:
               STORE_123456
            --------------------------------------------- */

            let vendorId = null;

            const newMatch =
              text.match(
                /CL_VENDOR_(\d+)/
              );

            const oldMatch =
              text.match(
                /STORE_(\d+)/
              );

            if (newMatch) {
              vendorId = newMatch[1];
            } else if (oldMatch) {
              vendorId = oldMatch[1];
            }


            if (vendorId) {

              const vendor =
                await getVendor(
                  vendorId
                );

              if (!vendor) {

                await sendWhatsApp(
                  from,
                  'Sorry, this CityLords business link is no longer active.'
                );

                continue;
              }

              /*
                Basic welcome for now.

                Full AI customer assistant will be connected
                after Meta/WhatsApp activation and testing.
              */
              await sendWhatsApp(
                from,
                `Welcome to ${vendor.shop_name}! 👋\n\n` +
                `You are now connected through CityLords.\n\n` +
                `How can we help you today?`
              );

            } else {

              /*
                No vendor marker found.

                We do not guess a vendor.
              */
              await sendWhatsApp(
                from,
                `Welcome to CityLords! 🏙️\n\n` +
                `Please open the business's CityLords link ` +
                `to start chatting with that business.`
              );
            }
          }
        }
      }

    } catch (e) {

      console.log(
        'WhatsApp webhook error:',
        e
      );
    }
  }
);


/* =========================================================
   CUSTOMER STORE LINK
========================================================= */

app.get(
  '/store/:id',
  async (req, res) => {

    try {

      const id =
        String(req.params.id);

      const vendor =
        await getVendor(id);

      if (!vendor) {
        return res
          .status(404)
          .send(
            'CityLords business not found.'
          );
      }

      /*
        Generic CityLords marker.

        It does NOT depend on whether the business is called:
        Store, Enterprise, Boutique, Company, Hub, etc.
      */
      const msg =
        `CL_VENDOR_${vendor.telegram_id} ` +
        `Hi ${vendor.shop_name}, I found you on CityLords.`;

      /*
        CITYLORDS_WA should contain the CityLords WhatsApp
        number in international format.
      */
      if (!CITYLORDS_WA) {

        return res
          .status(500)
          .send(
            'CityLords WhatsApp number is not configured yet.'
          );
      }

      const link =
        `https://wa.me/${CITYLORDS_WA}` +
        `?text=${encodeURIComponent(msg)}`;

      return res.redirect(link);

    } catch (e) {

      console.log(
        '/store error:',
        e.message
      );

      return res
        .status(500)
        .send(
          'Something went wrong.'
        );
    }
  }
);


/* =========================================================
   BASIC ADMIN
========================================================= */

app.get(
  '/admin',
  async (req, res) => {

    try {

      const result =
        await supabase
          .from('vendors')
          .select('*')
          .order(
            'created_at',
            {
              ascending: false
            }
          );

      if (result.error) {

        return res
          .status(500)
          .send(
            'Admin database error: ' +
            result.error.message
          );
      }

      const vendors =
        result.data || [];

      let html =
        '<h1>CityLords Vendors</h1>';

      html +=
        `<p>Total vendors: ${vendors.length}</p>`;

      html += '<hr>';

      for (const vendor of vendors) {

        html +=
          `<div style="margin-bottom:20px;">` +
          `<strong>${vendor.shop_name || ''}</strong><br>` +
          `Telegram: ${vendor.telegram_id || ''}<br>` +
          `Category: ${vendor.category || ''}<br>` +
          `WhatsApp: ${vendor.whatsapp_display || vendor.whatsapp || ''}<br>` +
          `Products: ${vendor.product_count || 0}` +
          `</div>`;
      }

      return res.send(html);

    } catch (e) {

      console.log(
        '/admin error:',
        e.message
      );

      return res
        .status(500)
        .send(
          'Admin error.'
        );
    }
  }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
  PORT,
  async () => {

    console.log(
      `CityLords server running on port ${PORT}`
    );

    try {

      if (WEBHOOK_URL) {

        /*
          Render deployment:
          use Telegram webhook.
        */

        await bot.telegram.setWebhook(
          WEBHOOK_URL + '/webhook'
        );

        console.log(
          'Telegram webhook set:',
          WEBHOOK_URL + '/webhook'
        );

      } else {

        /*
          Local development:
          clear webhook and use polling.
        */

        await bot.telegram.deleteWebhook();

        await bot.launch({
          dropPendingUpdates: true
        });

        console.log(
          'Telegram bot running with polling.'
        );
      }

    } catch (e) {

      console.log(
        'Telegram startup error:',
        e.message
      );
    }
  }
);


/* =========================================================
   GRACEFUL SHUTDOWN
========================================================= */

process.once(
  'SIGINT',
  () => bot.stop('SIGINT')
);

process.once(
  'SIGTERM',
  () => bot.stop('SIGTERM')
);
