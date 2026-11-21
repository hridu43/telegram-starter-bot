
import { Keyboard, InlineKeyboard } from "grammy"
import fs from "node:fs/promises"

const ADMIN_ID = 8597790913
const VIDEO_FILE = "./videos.json"
const USER_FILE = "./users.json"
const CLICK_FILE = "./clicks.json"

const COOLDOWN = 2 * 60 * 1000

const keyboard = new Keyboard()
  .text("🎬 ডেমো")
  .text("📊 Statistics")
  .resized()

const busyChats = new Set()
const pendingBroadcast = new Map()

async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"))
  } catch {
    return fallback
  }
}

async function writeJSON(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2))
}

async function loadVideos() {
  return await readJSON(VIDEO_FILE, [])
}

async function saveVideos(videos) {
  await writeJSON(VIDEO_FILE, videos)
}

// User statistics
let userWriteQueue = Promise.resolve()

async function loadUsers() {
  return await readJSON(USER_FILE, {})
}

async function recordUser(userId) {
  userWriteQueue = userWriteQueue
    .then(async () => {
      const users = await loadUsers()
      const id = String(userId)
      const now = new Date().toISOString()

      if (!users[id]) {
        users[id] = {
          firstSeen: now,
          lastActive: now
        }
      } else {
        users[id].lastActive = now
      }

      await writeJSON(USER_FILE, users)
    })
    .catch(err => {
      console.log("User tracking error:", err.message)
    })

  await userWriteQueue
}

// Demo click statistics
let clickWriteQueue = Promise.resolve()

async function loadClicks() {
  return await readJSON(CLICK_FILE, {
    total: 0,
    users: {}
  })
}

async function recordDemoClick(userId) {
  clickWriteQueue = clickWriteQueue
    .then(async () => {
      const data = await loadClicks()
      const id = String(userId)
      const now = Date.now()

      if (!data.users[id]) {
        data.users[id] = {
          lastCounted: 0,
          total: 0
        }
      }

      const user = data.users[id]

      if (now - user.lastCounted < COOLDOWN) return

      user.lastCounted = now
      user.total++
      data.total++

      await writeJSON(CLICK_FILE, data)
    })
    .catch(err => {
      console.log("Click tracking error:", err.message)
    })

  await clickWriteQueue
}

// Statistics
async function getStatistics() {
  const users = await loadUsers()
  const clicks = await loadClicks()

  const allUsers = Object.values(users)
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000

  const monthlyUsers = allUsers.filter(user =>
    new Date(user.lastActive).getTime() >= thirtyDaysAgo
  ).length

  return {
    total: allUsers.length,
    monthly: monthlyUsers,
    demoClicks: clicks.total,
    uniqueClickers: Object.keys(clicks.users).length
  }
}

// Send demo videos
async function sendDemoVideos(ctx) {
  const chatId = ctx.chat.id

  if (busyChats.has(chatId)) {
    await ctx.reply("⏳ আগের ডেমো ভিডিওগুলো পাঠানো হচ্ছে। একটু অপেক্ষা করো।")
    return
  }

  const videos = await loadVideos()

  if (videos.length === 0) {
    await ctx.reply("এখনো কোনো ডেমো ভিডিও যোগ করা হয়নি।")
    return
  }

  busyChats.add(chatId)

  try {
    await ctx.reply("🎬 ডেমো ভিডিও পাঠানো হচ্ছে...")

    for (const fileId of videos) {
      try {
        const sent = await ctx.api.sendVideo(chatId, fileId)

        setTimeout(() => {
          ctx.api.deleteMessage(chatId, sent.message_id)
            .catch(err => {
              console.log("Delete error:", err.message)
            })
        }, 120000)

      } catch (err) {
        console.log("Video error:", err.message)
      }
    }

    await ctx.reply(
      "📌 *বিশেষ অনুরোধ*\n\n" +
      "দয়া করে ভিডিওগুলো ফরওয়ার্ড করে রাখুন। " +
      "২ মিনিট পর অটোমেটিক ভিডিও ডিলিট হয়ে যাবে।\n\n" +
      "💎 গ্রুপের প্রিমিয়াম মেম্বারশিপের জন্য " +
      "ইনবক্স করুন: @shahaa56",
      { parse_mode: "Markdown" }
    )

  } finally {
    busyChats.delete(chatId)
  }
}

export function registerCommands(bot) {

  // Track users and capture Admin broadcast message
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await recordUser(ctx.from.id)
    }

    if (
      ctx.from?.id === ADMIN_ID &&
      ctx.message &&
      pendingBroadcast.has(String(ADMIN_ID))
    ) {
      const state = pendingBroadcast.get(String(ADMIN_ID))

      if (state.awaiting) {
        if (ctx.message.text === "/cancel") {
          pendingBroadcast.delete(String(ADMIN_ID))
          await ctx.reply("❌ Broadcast বাতিল করা হয়েছে।")
          return
        }

        state.chatId = ctx.chat.id
        state.messageId = ctx.message.message_id
        state.awaiting = false

        const confirmKeyboard = new InlineKeyboard()
          .text("✅ সবাইকে পাঠাও", "broadcast:confirm")
          .text("❌ বাতিল", "broadcast:cancel")

        await ctx.reply(
          "📢 তোমার মেসেজটি প্রস্তুত!\n\n" +
          "উপরের মেসেজটি সব ব্যবহারকারীকে পাঠাতে চাইলে Confirm করো।",
          { reply_markup: confirmKeyboard }
        )

        return
      }
    }

    await next()
  })

  // Start: Show keyboard and automatically send videos
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "স্বাগতম! ❤️\n\n" +
      "তোমার জন্য ডেমো ভিডিও পাঠানো হচ্ছে।\n\n" +
      "আবার দেখতে চাইলে নিচের 🎬 ডেমো বাটনে ক্লিক করো।",
      { reply_markup: keyboard }
    )

    await sendDemoVideos(ctx)
  })

  // Statistics: Admin only
  bot.command("stats", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return ctx.reply("এই কমান্ড শুধু Admin ব্যবহার করতে পারবেন।")
    }

    const stats = await getStatistics()

    await ctx.reply(
      "📊 *Demo Bot Statistics*\n\n" +
      `👥 মোট ইউজার: ${stats.total}\n` +
      `📅 গত ৩০ দিনের ইউজার: ${stats.monthly}\n` +
      `🎬 মোট গণনা করা ডেমো ক্লিক: ${stats.demoClicks}\n` +
      `👤 ডেমো ব্যবহারকারী: ${stats.uniqueClickers}`,
      { parse_mode: "Markdown" }
    )
  })

  bot.hears("📊 Statistics", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return ctx.reply("Statistics শুধু Admin দেখতে পারবেন।")
    }

    const stats = await getStatistics()

    await ctx.reply(
      "📊 *Demo Bot Statistics*\n\n" +
      `👥 মোট ইউজার: ${stats.total}\n` +
      `📅 গত ৩০ দিনের ইউজার: ${stats.monthly}\n` +
      `🎬 মোট গণনা করা ডেমো ক্লিক: ${stats.demoClicks}\n` +
      `👤 ডেমো ব্যবহারকারী: ${stats.uniqueClickers}`,
      { parse_mode: "Markdown" }
    )
  })

  // Start broadcast
  bot.command("broadcast", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return ctx.reply("এই কমান্ড শুধু Admin ব্যবহার করতে পারবেন।")
    }

    pendingBroadcast.set(String(ADMIN_ID), {
      awaiting: true
    })

    await ctx.reply(
      "📢 Broadcast Message\n\n" +
      "এখন যে মেসেজটি সবাইকে পাঠাতে চাও সেটি পাঠাও।\n\n" +
      "Text, ছবি, ভিডিও, অডিও, ভয়েস, PDF বা ফাইল পাঠাতে পারবে।\n\n" +
      "বাতিল করতে /cancel লিখো।"
    )
  })

  // Confirm broadcast
  bot.callbackQuery("broadcast:confirm", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return ctx.answerCallbackQuery({
        text: "শুধু Admin এটি করতে পারবেন।",
        show_alert: true
      })
    }

    const state = pendingBroadcast.get(String(ADMIN_ID))

    if (!state || state.awaiting || !state.messageId) {
      await ctx.answerCallbackQuery({
        text: "কোনো Broadcast মেসেজ পাওয়া যায়নি।",
        show_alert: true
      })
      return
    }

    pendingBroadcast.delete(String(ADMIN_ID))

    await ctx.answerCallbackQuery({
      text: "Broadcast শুরু হচ্ছে..."
    })

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
    })

    const users = await loadUsers()
    const userIds = Object.keys(users)

    let success = 0
    let failed = 0

    await ctx.reply(
      `📢 Broadcast শুরু হয়েছে!\nমোট ব্যবহারকারী: ${userIds.length}`
    )

    for (const userId of userIds) {
      try {
        await ctx.api.copyMessage(
          userId,
          state.chatId,
          state.messageId
        )
        success++
      } catch (err) {
        failed++
        console.log(`Broadcast failed for ${userId}:`, err.message)
      }

      await new Promise(resolve => setTimeout(resolve, 40))
    }

    await ctx.reply(
      "✅ Broadcast সম্পন্ন!\n\n" +
      `👥 মোট ব্যবহারকারী: ${userIds.length}\n` +
      `✅ সফলভাবে পাঠানো হয়েছে: ${success}\n` +
      `❌ পাঠানো যায়নি: ${failed}`
    )
  })

  // Cancel broadcast
  bot.callbackQuery("broadcast:cancel", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
      return ctx.answerCallbackQuery({
        text: "শুধু Admin এটি করতে পারবেন।"
      })
    }

    pendingBroadcast.delete(String(ADMIN_ID))

    await ctx.answerCallbackQuery({
      text: "Broadcast বাতিল করা হয়েছে।"
    })

    await ctx.editMessageReplyMarkup({
      reply_markup: new InlineKeyboard()
    })

    await ctx.reply("❌ Broadcast বাতিল করা হয়েছে।")
  })

  // Add video
  async function addVideo(ctx, fileId) {
    if (ctx.from.id !== ADMIN_ID) return

    const videos = await loadVideos()
    videos.push(fileId)
    await saveVideos(videos)

    await ctx.reply(`ভিডিও সেভ হয়েছে। মোট ভিডিও: ${videos.length}`)
  }

  bot.on("message:video", async (ctx) => {
    await addVideo(ctx, ctx.message.video.file_id)
  })

  bot.on("message:document", async (ctx) => {
    const doc = ctx.message.document

    if (doc.mime_type?.startsWith("video/")) {
      await addVideo(ctx, doc.file_id)
    }
  })

  // Count saved videos
  bot.command("count", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return

    const videos = await loadVideos()
    await ctx.reply(`মোট সেভ করা ভিডিও: ${videos.length}`)
  })

  // Remove videos
  bot.command("remove", async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) return

    const videos = await loadVideos()
    const number = String(ctx.match || "").trim()

    if (videos.length === 0) {
      await ctx.reply("কোনো ভিডিও সেভ করা নেই।")
      return
    }

    if (!number) {
      await ctx.reply(
        "যে ভিডিওটি সরাতে চাও, সেটি নম্বর দেখে নাও।\n\n" +
        "সরাতে লিখবে: /remove 5"
      )

      for (let i = 0; i < videos.length; i++) {
        try {
          await ctx.api.sendVideo(ctx.chat.id, videos[i], {
            caption: `ভিডিও নম্বর: ${i + 1}`
          })
        } catch (err) {
          console.log("Preview error:", err.message)
        }
      }
      return
    }

    if (!/^\d+$/.test(number)) {
      await ctx.reply("সঠিক নম্বর দাও। যেমন: /remove 5")
      return
    }

    const index = Number(number) - 1

    if (index < 0 || index >= videos.length) {
      await ctx.reply("এই নম্বরের কোনো ভিডিও নেই।")
      return
    }

    videos.splice(index, 1)
    await saveVideos(videos)

    await ctx.reply(
      `ভিডিও নম্বর ${number} সরানো হয়েছে।\n` +
      `এখন মোট ভিডিও: ${videos.length}`
    )
  })

  // Demo button: Send videos again
  bot.hears("🎬 ডেমো", async (ctx) => {
    await recordDemoClick(ctx.from.id)
    await sendDemoVideos(ctx)
  })
}
