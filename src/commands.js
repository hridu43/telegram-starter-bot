
import { Keyboard } from "grammy"
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
  userWriteQueue = userWriteQueue.then(async () => {
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

  try {
    await userWriteQueue
  } catch (err) {
    console.log("User tracking error:", err.message)
  }
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
  clickWriteQueue = clickWriteQueue.then(async () => {
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

    if (now - user.lastCounted < COOLDOWN) {
      return
    }

    user.lastCounted = now
    user.total++
    data.total++

    await writeJSON(CLICK_FILE, data)
  })

  try {
    await clickWriteQueue
  } catch (err) {
    console.log("Click tracking error:", err.message)
  }
}

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

export function registerCommands(bot) {

  // Track users
  bot.use(async (ctx, next) => {
    if (ctx.from) {
      await recordUser(ctx.from.id)
    }
    await next()
  })

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "স্বাগতম! নিচের ডেমো বাটনে ক্লিক করো।",
      { reply_markup: keyboard }
    )
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

  // Old Statistics button is private to Admin
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

  // Demo button
  bot.hears("🎬 ডেমো", async (ctx) => {
    const chatId = ctx.chat.id

    // Count once per user every two minutes
    await recordDemoClick(ctx.from.id)

    if (busyChats.has(chatId)) return

    const videos = await loadVideos()

    if (videos.length === 0) {
      await ctx.reply("এখনো কোনো ভিডিও যোগ করা হয়নি।")
      return
    }

    busyChats.add(chatId)

    try {
      await ctx.reply("ডেমো ভিডিও পাঠানো হচ্ছে...")

      for (const fileId of videos) {
        try {
          const sent = await ctx.api.sendVideo(chatId, fileId)

          setTimeout(() => {
            ctx.api.deleteMessage(chatId, sent.message_id)
              .catch(err => console.log("Delete error:", err.message))
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
  })
}
