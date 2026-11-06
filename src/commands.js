

import { Keyboard } from "grammy"
import fs from "node:fs/promises"

const ADMIN_ID = 8597790913
const VIDEO_FILE = "./videos.json"

const keyboard = new Keyboard()
  .text("🎬 ডেমো")
  .resized()

const busyChats = new Set()

async function loadVideos() {
  try {
    return JSON.parse(await fs.readFile(VIDEO_FILE, "utf8"))
  } catch {
    return []
  }
}

async function saveVideos(videos) {
  await fs.writeFile(VIDEO_FILE, JSON.stringify(videos))
}

export function registerCommands(bot) {
  bot.command("start", async (ctx) => {
    await ctx.reply("স্বাগতম! নিচের ডেমো বাটনে ক্লিক করো।", {
      reply_markup: keyboard,
    })
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

  bot.hears("🎬 ডেমো", async (ctx) => {
    const chatId = ctx.chat.id

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
              .catch((err) => console.log("Delete error:", err.message))
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
