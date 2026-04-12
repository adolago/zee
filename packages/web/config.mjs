const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://zee.dev" : `https://${stage}.zee.dev`,
  console: stage === "production" ? "https://zee.dev/providers/opencode-zen" : `https://${stage}.zee.dev/providers/opencode-zen`,
  email: "support@zee.dev",
  socialCard: "https://zee.dev/social-card.png",
  github: "https://github.com/adolago/zee",
  discord: "https://github.com/adolago/zee/discussions",
  headerLinks: [
    { name: "Home", url: "/" },
    { name: "Docs", url: "/docs/" },
  ],
}
