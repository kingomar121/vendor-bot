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

/* WhatsApp - not required for current Telegram testing */
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const CITYLORDS_WA = process.env.CITYLORDS_WA;
const VERIFY_TOKEN =
  process.env.VERIFY_TOKEN || 'citylords123';

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_KEY
);

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


/* =========================================================
   TELEGRAM DUPLICATE PROTECTION
========================================================= */

const processedUpdates = new Set();
const MAX_PROCESSED_UPDATES = 5000;

function isDuplicateUpdate(updateId) {
  if (updateId === undefined || updateId === null) {
    return false;
  }

  const key = String(updateId);

  if (processedUpdates.has(key)) {
    return true;
  }

  processedUpdates.add(key);

  if (processedUpdates.size > MAX_PROCESSED_UPDATES) {
    const first =
      processedUpdates.values().next().value;

    processedUpdates.delete(first);
  }

  return false;
}


/* =========================================================
   TELEGRAM LOGGING
========================================================= */

function logUpdate(update) {
  try {
    const message =
      update?.message ||
      update?.edited_message ||
      null;

    if (!message) {
      console.log(
        '[TELEGRAM] Non-message update:',
        update?.update_id
      );
      return;
    }

    console.log(
      '[TELEGRAM] UPDATE RECEIVED:',
      update.update_id
    );

    console.log(
      '[TELEGRAM] USER:',
      message.from?.id
    );

    console.log(
      '[TELEGRAM] TEXT:',
      message.text || '(no text)'
    );

  } catch (e) {
    console.log(
      '[TELEGRAM] Logging error:',
      e.message
    );
  }
}


/* =========================================================
   WHATSAPP NUMBER HELPERS
========================================================= */

function normalizeWa(raw) {
  let d = String(raw || '')
    .replace(/[^0-9]/g, '');

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
    return (
      '+234 ' +
      d.slice(3, 6) +
      ' ' +
      d.slice(6, 9) +
      ' ' +
      d.slice(9)
    );
  }

  return '+' + d;
}


/* =========================================================
   BUSINESS NAME NORMALIZATION
========================================================= */

function normalizeBusinessName(name) {
  return String(name || '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.,!?]+$/g, '')
    .trim();
}


/* =========================================================
   ONBOARDING SESSION FUNCTIONS
========================================================= */

async function getSession(telegramId) {
  try {
    const result = await supabase
      .from('onboarding_sessions')
      .select('*')
      .eq('telegram_id', String(telegramId))
      .maybeSingle();

    if (result.error) {
      console.log(
        '[SESSION] get error:',
        result.error.message
      );

      return null;
    }

    return result.data;

  } catch (e) {
    console.log(
      '[SESSION] get exception:',
      e.message
    );

    return null;
  }
}


async function setSession(
  telegramId,
  step,
  data
) {
  try {
    const result = await supabase
      .from('onboarding_sessions')
      .upsert(
        {
          telegram_id: String(telegramId),
          step: step,
          data: data,
          updated_at: new Date().toISOString()
        },
        {
          onConflict: 'telegram_id'
        }
      );

    if (result.error) {
      console.log(
        '[SESSION] set error:',
        result.error.message
      );
    }

    return result;

  } catch (e) {
    console.log(
      '[SESSION] set exception:',
      e.message
    );

    return null;
  }
}


async function deleteSession(telegramId) {
  try {
    const result = await supabase
      .from('onboarding_sessions')
      .delete()
      .eq('telegram_id', String(telegramId));

    if (result.error) {
      console.log(
        '[SESSION] delete error:',
        result.error.message
      );
    }

    return result;

  } catch (e) {
    console.log(
      '[SESSION] delete exception:',
      e.message
    );

    return null;
  }
}


/* =========================================================
   VENDOR FUNCTIONS
========================================================= */

async function getVendor(telegramId) {
  try {
    const result = await supabase
      .from('vendors')
      .select('*')
      .eq('telegram_id', String(telegramId))
      .maybeSingle();

    if (result.error) {
      console.log(
        '[VENDOR] get error:',
        result.error.message
      );

      return null;
    }

    return result.data;

  } catch (e) {
    console.log(
      '[VENDOR] get exception:',
      e.message
    );

    return null;
  }
}


/*
   Existing business-name detection.

   First try Supabase case-insensitive exact match.

   Then perform a normalized comparison in JavaScript
   so differences such as:

   Husna Stores
   husna stores
   HUSNA STORES
   Husna   Stores

   are treated as the same business name.
*/
async function getVendorByBusinessName(name) {
  const target =
    normalizeBusinessName(name);

  if (!target) {
    return null;
  }

  try {

    /* ---------------------------------------------
       FIRST CHECK: database case-insensitive match
    --------------------------------------------- */

    const directResult = await supabase
      .from('vendors')
      .select('*')
      .ilike('shop_name', name.trim())
      .limit(1);

    if (
      !directResult.error &&
      directResult.data &&
      directResult.data.length > 0
    ) {
      return directResult.data[0];
    }


    /* ---------------------------------------------
       SECOND CHECK: normalized comparison
    --------------------------------------------- */

    const allResult = await supabase
      .from('vendors')
      .select(
        'telegram_id,shop_name,whatsapp,whatsapp_display,category,product_count,status,created_at'
      );

    if (allResult.error) {
      console.log(
        '[BUSINESS NAME] search error:',
        allResult.error.message
      );

      return null;
    }

    const vendors =
      allResult.data || [];

    for (const vendor of vendors) {

      const existingName =
        normalizeBusinessName(
          vendor.shop_name
        );

      if (existingName === target) {
        return vendor;
      }
    }

    return null;

  } catch (e) {

    console.log(
      '[BUSINESS NAME] exception:',
      e.message
    );

    return null;
  }
}


/* =========================================================
   CREATE VENDOR
========================================================= */

async function createVendor(
  telegramId,
  details
) {
  const existing =
    await getVendor(telegramId);

  const productCount =
    details.product_count !== undefined
      ? details.product_count
      : (
          existing
            ? existing.product_count
            : 0
        );

  const vendor = {
    telegram_id:
      String(telegramId),

    shop_name:
      details.shop_name ||
      (
        existing
          ? existing.shop_name
          : null
      ),

    whatsapp:
      details.whatsapp
        ? normalizeWa(details.whatsapp)
        : (
            existing
              ? existing.whatsapp
              : null
          ),

    whatsapp_display:
      details.whatsapp
        ? prettyWa(
            normalizeWa(
              details.whatsapp
            )
          )
        : (
            existing
              ? existing.whatsapp_display
              : null
          ),

    category:
      details.category ||
      (
        existing
          ? existing.category
          : null
      ),

    product_count:
      productCount,

    status:
      'approved',

    created_at:
      existing
        ? existing.created_at
        : new Date().toISOString()
  };


  const result =
    await supabase
      .from('vendors')
      .upsert(
        vendor,
        {
          onConflict:
            'telegram_id'
        }
      );

  if (result.error) {

    console.log(
      '[VENDOR] create error:',
      result.error.message
    );

    throw new Error(
      result.error.message
    );
  }


  /* ---------------------------------------------
     Save products
  --------------------------------------------- */

  if (
    details.raw_products &&
    details.raw_products.length > 0
  ) {

    const deleteResult =
      await supabase
        .from('products')
        .delete()
        .eq(
          'vendor_id',
          String(telegramId)
        );

    if (deleteResult.error) {
      console.log(
        '[PRODUCTS] delete error:',
        deleteResult.error.message
      );
    }


    for (
      const product
      of details.raw_products
    ) {

      const parts =
        String(product).split('-');

      const productName =
        parts[0]
          ? parts[0].trim()
          : '';

      const price =
        parts
          .slice(1)
          .join('-')
          .trim() || '0';

      if (!productName) {
        continue;
      }

      const insertResult =
        await supabase
          .from('products')
          .insert({
            vendor_id:
              String(telegramId),

            name:
              productName,

            price:
              price
          });

      if (insertResult.error) {
        console.log(
          '[PRODUCTS] insert error:',
          insertResult.error.message
        );
      }
    }
  }

  return vendor;
}


/* =========================================================
   VENDOR MENU
========================================================= */

function vendorMenu() {
  return Markup.keyboard([
    [
      '🏪 Business Name',
      '📦 Products'
    ],
    [
      '💰 Prices',
      '❓ FAQs'
    ],
    [
      '🤖 Assistant Name',
      '📱 WhatsApp Number'
    ],
    [
      '📝 Business Information',
      '🔗 My Store Link'
    ],
    [
      '📊 Dashboard',
      '⚙️ Settings'
    ]
  ])
    .resize();
}


/* =========================================================
   EXISTING VENDOR RESPONSE
========================================================= */

async function showExistingVendor(
  ctx,
  vendor
) {
  console.log(
    '[VENDOR] EXISTING VENDOR FOUND:',
    vendor.telegram_id,
    vendor.shop_name
  );

  return ctx.reply(
    `Welcome back to CityLords! 🏙️\n\n` +
    `🏪 Business: ${
      vendor.shop_name || 'Your business'
    }\n\n` +
    `Your vendor account is already registered.\n` +
    `You do not need to register again.\n\n` +
    `What would you like to manage?`,
    vendorMenu()
  );
}


/* =========================================================
   START REGISTRATION
========================================================= */

async function startRegistration(ctx) {

  const telegramId =
    String(ctx.from.id);

  console.log(
    '[START] Telegram ID:',
    telegramId
  );


  /* ---------------------------------------------
     ALWAYS CHECK VENDOR FIRST
  --------------------------------------------- */

  const vendor =
    await getVendor(telegramId);

  console.log(
    '[START] Vendor found:',
    vendor ? 'YES' : 'NO'
  );


  if (vendor) {

    /*
       CRITICAL:

       Existing vendor wins over everything.

       Even if an old onboarding_sessions row exists,
       this person is already a vendor.
    */

    await deleteSession(
      telegramId
    );

    return showExistingVendor(
      ctx,
      vendor
    );
  }


  /* ---------------------------------------------
     NO VENDOR:

     /start means START CLEANLY.

     Delete any stale onboarding session.
  --------------------------------------------- */

  const oldSession =
    await getSession(telegramId);

  console.log(
    '[START] Old session found:',
    oldSession ? 'YES' : 'NO'
  );


  if (oldSession) {

    console.log(
      '[START] Removing stale session.'
    );

    await deleteSession(
      telegramId
    );
  }


  /* ---------------------------------------------
     Create a fresh registration session
  --------------------------------------------- */

  await setSession(
    telegramId,
    'business_name',
    {
      products: []
    }
  );

  console.log(
    '[START] New registration started.'
  );


  return ctx.reply(
    'Welcome to CityLords! 🏙️\n\n' +
    'Let\'s register your business.\n\n' +
    'What is your business name?'
  );
}


/* =========================================================
   /START
========================================================= */

bot.start(
  async (ctx) => {

    try {

      console.log(
        '[HANDLER] /start'
      );

      return await startRegistration(
        ctx
      );

    } catch (e) {

      console.log(
        '[HANDLER] /start ERROR:',
        e
      );

      return ctx.reply(
        'Sorry, something went wrong. Please try again.'
      );
    }
  }
);


/* =========================================================
   /VENDOR123
========================================================= */

bot.command(
  'vendor123',
  async (ctx) => {

    try {

      console.log(
        '[HANDLER] /vendor123'
      );

      return await startRegistration(
        ctx
      );

    } catch (e) {

      console.log(
        '[HANDLER] /vendor123 ERROR:',
        e
      );

      return ctx.reply(
        'Sorry, something went wrong. Please try again.'
      );
    }
  }
);


/* =========================================================
   NORMAL TEXT
========================================================= */

bot.on(
  'text',
  async (ctx) => {

    const telegramId =
      String(ctx.from.id);

    const text =
      String(
        ctx.message.text || ''
      ).trim();


    if (!text) {
      return;
    }


    /*
       Commands are handled by their command handlers.
    */

    if (
      text.startsWith('/')
    ) {
      return;
    }


    try {

      console.log(
        '[TEXT] Telegram ID:',
        telegramId
      );

      console.log(
        '[TEXT] Message:',
        text
      );


      /* ---------------------------------------------
         MOST IMPORTANT CHECK:
         IS THIS ALREADY A REGISTERED VENDOR?
      --------------------------------------------- */

      const vendor =
        await getVendor(
          telegramId
        );

      console.log(
        '[TEXT] Vendor found:',
        vendor ? 'YES' : 'NO'
      );


      if (vendor) {

        /*
           Never send an existing vendor back
           into registration.
        */

        await deleteSession(
          telegramId
        );

        return showExistingVendor(
          ctx,
          vendor
        );
      }


      /* ---------------------------------------------
         Get onboarding session
      --------------------------------------------- */

      const session =
        await getSession(
          telegramId
        );

      console.log(
        '[TEXT] Session found:',
        session ? 'YES' : 'NO'
      );


      if (!session) {

        console.log(
          '[TEXT] No session. Starting registration.'
        );

        await setSession(
          telegramId,
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


      let data =
        session.data || {};

      const step =
        session.step;


      console.log(
        '[TEXT] Current step:',
        step
      );


      /* =================================================
         BUSINESS NAME
      ================================================= */

      if (
        step === 'business_name'
      ) {

        const businessName =
          text;

        console.log(
          '[NAME] Checking:',
          businessName
        );


        /*
           Check whether this business already exists.
        */

        const existingBusiness =
          await getVendorByBusinessName(
            businessName
          );


        console.log(
          '[NAME] Existing business:',
          existingBusiness
            ? 'YES'
            : 'NO'
        );


        if (existingBusiness) {

          console.log(
            '[NAME] DUPLICATE BUSINESS:',
            existingBusiness.shop_name
          );


          /*
             If it belongs to this Telegram account,
             recognize the vendor instead.
          */

          if (
            String(
              existingBusiness.telegram_id
            ) === telegramId
          ) {

            await deleteSession(
              telegramId
            );

            return showExistingVendor(
              ctx,
              existingBusiness
            );
          }


          return ctx.reply(
            `⚠️ The business name "${businessName}" ` +
            `is already registered on CityLords.\n\n` +
            `Please enter another business name.`
          );
        }


        /* ---------------------------------------------
           Save business name
        --------------------------------------------- */

        data.shop_name =
          businessName;


        await setSession(
          telegramId,
          'whatsapp',
          data
        );


        return ctx.reply(
          `Great! "${businessName}" ✅\n\n` +
          `What is your WhatsApp number?\n` +
          `Example: 08012345678`
        );
      }


      /* =================================================
         WHATSAPP
      ================================================= */

      if (
        step === 'whatsapp'
      ) {

        const normalized =
          normalizeWa(text);


        if (
          !normalized ||
          normalized.length < 10
        ) {

          return ctx.reply(
            'Please enter a valid Nigerian WhatsApp number.\n\n' +
            'Example: 08012345678'
          );
        }


        data.whatsapp =
          normalized;


        await setSession(
          telegramId,
          'category',
          data
        );


        return ctx.reply(
          `Number ${prettyWa(normalized)} ✅\n\n` +
          `Choose your category:`,
          Markup.keyboard(
            CATEGORIES.map(
              category => [category]
            )
          )
            .oneTime()
            .resize()
        );
      }


      /* =================================================
         CATEGORY
      ================================================= */

      if (
        step === 'category'
      ) {

        if (
          !CATEGORIES.includes(text)
        ) {

          return ctx.reply(
            'Please choose from the list below:',
            Markup.keyboard(
              CATEGORIES.map(
                category => [category]
              )
            )
              .oneTime()
              .resize()
          );
        }


        data.category =
          text;

        data.products =
          [];


        await setSession(
          telegramId,
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


      /* =================================================
         PRODUCTS
      ================================================= */

      if (
        step === 'products'
      ) {

        /* ---------------------------------------------
           FINISH REGISTRATION
        --------------------------------------------- */

        if (
          text.toLowerCase() === 'done'
        ) {

          const products =
            data.products || [];


          if (
            products.length === 0
          ) {

            return ctx.reply(
              'Please add at least one product first.\n\n' +
              'Example: Rice - 5000'
            );
          }


          /* -------------------------------------------
             FINAL TELEGRAM-ID CHECK
          ------------------------------------------- */

          const vendorNow =
            await getVendor(
              telegramId
            );


          if (vendorNow) {

            await deleteSession(
              telegramId
            );

            return showExistingVendor(
              ctx,
              vendorNow
            );
          }


          /* -------------------------------------------
             FINAL BUSINESS-NAME CHECK
          ------------------------------------------- */

          const duplicateBusiness =
            await getVendorByBusinessName(
              data.shop_name
            );


          if (duplicateBusiness) {

            if (
              String(
                duplicateBusiness.telegram_id
              ) === telegramId
            ) {

              await deleteSession(
                telegramId
              );

              return showExistingVendor(
                ctx,
                duplicateBusiness
              );
            }


            return ctx.reply(
              `⚠️ The business name "${data.shop_name}" ` +
              `has already been registered by another vendor.\n\n` +
              `Please restart with another business name.`
            );
          }


          /* -------------------------------------------
             CREATE VENDOR
          ------------------------------------------- */

          const createdVendor =
            await createVendor(
              telegramId,
              {
                shop_name:
                  data.shop_name,

                whatsapp:
                  data.whatsapp,

                category:
                  data.category,

                product_count:
                  products.length,

                raw_products:
                  products
              }
            );


          /* -------------------------------------------
             DELETE REGISTRATION SESSION
          ------------------------------------------- */

          await deleteSession(
            telegramId
          );


          const storeLink =
            `${WEBHOOK_URL}/store/${telegramId}`;


          return ctx.reply(
            `🎉 CityLords registration complete!\n\n` +
            `🏪 Business: ${createdVendor.shop_name}\n` +
            `📂 Category: ${createdVendor.category}\n` +
            `📦 Products: ${products.length}\n\n` +
            `🔗 Your CityLords store link:\n` +
            `${storeLink}\n\n` +
            `You can return anytime to manage your business.`,
            vendorMenu()
          );
        }


        /* ---------------------------------------------
           ADD PRODUCT
        --------------------------------------------- */

        data.products =
          data.products || [];


        data.products.push(
          text
        );


        await setSession(
          telegramId,
          'products',
          data
        );


        return ctx.reply(
          `✅ Added: ${text}\n\n` +
          `Products added: ${data.products.length}\n\n` +
          `Send another product or type DONE.`
        );
      }


      /* =================================================
         UNKNOWN STEP
      ================================================= */

      console.log(
        '[TEXT] Unknown registration step:',
        step
      );


      /*
         Instead of getting trapped forever,
         reset the registration cleanly.
      */

      await deleteSession(
        telegramId
      );

      await setSession(
        telegramId,
        'business_name',
        {
          products: []
        }
      );


      return ctx.reply(
        'Let\'s restart your registration. 🏙️\n\n' +
        'What is your business name?'
      );


    } catch (e) {

      console.log(
        '[TEXT HANDLER ERROR]:',
        e
      );


      return ctx.reply(
        'Sorry, something went wrong while processing your message.\n\n' +
        'Please try again.'
      );
    }
  }
);


/* =========================================================
   WHATSAPP SEND
========================================================= */

async function sendWhatsApp(
  to,
  message
) {

  if (
    !WHATSAPP_TOKEN ||
    !PHONE_NUMBER_ID
  ) {

    console.log(
      '[WHATSAPP] Not configured yet.'
    );

    return;
  }


  try {

    const url =
      `https://graph.facebook.com/v20.0/` +
      `${PHONE_NUMBER_ID}/messages`;


    const response =
      await fetch(
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
            messaging_product:
              'whatsapp',

            to:
              to,

            type:
              'text',

            text: {
              body:
                message
            }
          })
        }
      );


    const result =
      await response.json();


    console.log(
      '[WHATSAPP] Send result:',
      result
    );


  } catch (e) {

    console.log(
      '[WHATSAPP] Error:',
      e.message
    );
  }
}


/* =========================================================
   HOME
========================================================= */

app.get(
  '/',
  (req, res) => {
    res.send(
      'CityLords LIVE - TEST VERSION'
    );
  }
);


/* =========================================================
   TELEGRAM WEBHOOK
========================================================= */

app.post(
  '/webhook',
  async (req, res) => {

    const update =
      req.body;


    /*
       LOG EVERYTHING FIRST
    */

    logUpdate(update);


    /*
       ACKNOWLEDGE TELEGRAM IMMEDIATELY.

       This helps prevent Telegram from waiting for
       database operations.
    */

    res.sendStatus(200);


    /*
       DUPLICATE UPDATE CHECK
    */

    if (
      isDuplicateUpdate(
        update?.update_id
      )
    ) {

      console.log(
        '[TELEGRAM] DUPLICATE UPDATE IGNORED:',
        update.update_id
      );

      return;
    }


    /*
       Process Telegram update AFTER HTTP 200.
    */

    try {

      await bot.handleUpdate(
        update
      );

    } catch (e) {

      console.log(
        '[TELEGRAM] WEBHOOK PROCESSING ERROR:',
        e
      );
    }
  }
);


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
        '[WHATSAPP] Webhook verified.'
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
========================================================= */

app.post(
  '/whatsapp-webhook',
  async (req, res) => {

    /*
       Acknowledge Meta immediately.
    */

    res.sendStatus(200);


    try {

      const body =
        req.body;


      if (
        !body ||
        body.object !==
          'whatsapp_business_account'
      ) {
        return;
      }


      const entries =
        body.entry || [];


      for (
        const entry
        of entries
      ) {

        const changes =
          entry.changes || [];


        for (
          const change
          of changes
        ) {

          const value =
            change.value;


          if (!value) {
            continue;
          }


          const messages =
            value.messages || [];


          for (
            const message
            of messages
          ) {

            const from =
              message.from;

            const text =
              message.text?.body ||
              '';


            if (
              !from ||
              !text
            ) {
              continue;
            }


            console.log(
              '[WHATSAPP] Message:',
              from,
              text
            );


            let vendorId =
              null;


            const newMatch =
              text.match(
                /CL_VENDOR_(\d+)/
              );


            const oldMatch =
              text.match(
                /STORE_(\d+)/
              );


            if (newMatch) {

              vendorId =
                newMatch[1];

            } else if (
              oldMatch
            ) {

              vendorId =
                oldMatch[1];
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


              await sendWhatsApp(
                from,
                `Welcome to ${vendor.shop_name}! 👋\n\n` +
                `You are connected through CityLords.\n\n` +
                `How can we help you today?`
              );


            } else {

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
        '[WHATSAPP] Webhook error:',
        e
      );
    }
  }
);


/* =========================================================
   STORE LINK
========================================================= */

app.get(
  '/store/:id',
  async (req, res) => {

    try {

      const telegramId =
        String(req.params.id);


      const vendor =
        await getVendor(
          telegramId
        );


      if (!vendor) {

        return res
          .status(404)
          .send(
            'CityLords business not found.'
          );
      }


      if (!CITYLORDS_WA) {

        return res
          .status(500)
          .send(
            'CityLords WhatsApp number is not configured yet.'
          );
      }


      /*
         The business name does NOT control routing.

         Therefore it doesn't matter whether the business
         is called:

         Store
         Enterprise
         Boutique
         Company
         Hub
         Services
         etc.
      */

      const message =
        `CL_VENDOR_${vendor.telegram_id} ` +
        `Hi ${vendor.shop_name}, I found you on CityLords.`;


      const link =
        `https://wa.me/${CITYLORDS_WA}` +
        `?text=${encodeURIComponent(message)}`;


      return res.redirect(
        link
      );


    } catch (e) {

      console.log(
        '[STORE LINK] Error:',
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
   ADMIN
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


      html +=
        '<hr>';


      for (
        const vendor
        of vendors
      ) {

        html +=
          `<div style="margin-bottom:20px;">` +

          `<strong>${
            vendor.shop_name || ''
          }</strong><br>` +

          `Telegram: ${
            vendor.telegram_id || ''
          }<br>` +

          `Category: ${
            vendor.category || ''
          }<br>` +

          `WhatsApp: ${
            vendor.whatsapp_display ||
            vendor.whatsapp ||
            ''
          }<br>` +

          `Products: ${
            vendor.product_count || 0
          }` +

          `</div>`;
      }


      return res.send(
        html
      );


    } catch (e) {

      console.log(
        '[ADMIN] Error:',
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
      '======================================'
    );

    console.log(
      'CITYLORDS TEST SERVER STARTED'
    );

    console.log(
      'Port:',
      PORT
    );

    console.log(
      '======================================'
    );


    try {

      if (WEBHOOK_URL) {

        await bot.telegram.setWebhook(
          WEBHOOK_URL + '/webhook'
        );


        console.log(
          '[TELEGRAM] Webhook:',
          WEBHOOK_URL + '/webhook'
        );


      } else {

        await bot.telegram.deleteWebhook();


        await bot.launch({
          dropPendingUpdates: true
        });


        console.log(
          '[TELEGRAM] Polling mode active.'
        );
      }


    } catch (e) {

      console.log(
        '[TELEGRAM] Startup error:',
        e.message
      );
    }
  }
);


/* =========================================================
   SHUTDOWN
========================================================= */

process.once(
  'SIGINT',
  () => {
    bot.stop('SIGINT');
  }
);


process.once(
  'SIGTERM',
  () => {
    bot.stop('SIGTERM');
  }
);
