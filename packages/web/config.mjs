const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://zee-bot.com" : `https://${stage}.zee-bot.com`,
  console: stage === "production" ? "https://zee-bot.com/providers/opencode-zen" : `https://${stage}.zee-bot.com/providers/opencode-zen`,
  email: "support@zee-bot.com",
  socialCard: "https://zee-bot.com/social-card.png",
  github: "https://github.com/adolago/zee",
  discord: "https://github.com/adolago/zee/discussions",
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
