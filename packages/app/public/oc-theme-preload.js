;(function () {
  var themeId = localStorage.getItem("zee-theme-id")
  if (!themeId) return

  var scheme = localStorage.getItem("zee-color-scheme") || "dark"
  var isDark = scheme === "dark" || (scheme === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  var mode = isDark ? "dark" : "light"

  document.documentElement.dataset.theme = themeId
  document.documentElement.dataset.colorScheme = mode

  var css = localStorage.getItem("zee-theme-css-" + (isDark ? "dark" : "light"))

  if (css) {
    var style = document.createElement("style")
    style.id = "zee-theme-preload"
    style.textContent =
      ":root{color-scheme:" +
      mode +
      ";--text-mix-blend-mode:" +
      (isDark ? "plus-lighter" : "multiply") +
      ";" +
      css +
      "}"
    document.head.appendChild(style)
  }
})()
