export type PromptHeaderBorderLayoutInput = {
  width: number
  showContext: boolean
  contextText: string
  skillsText: string
  dictationText: string
  vimText: string
  modeText: string
  showVim: boolean
}

export type PromptHeaderBorderLayout = {
  showContext: boolean
  showSkills: boolean
  showDictation: boolean
  showVim: boolean
  showMode: boolean
  fill: string
}

function textWidth(text: string): number {
  return Bun.stringWidth(text)
}

function buildRightClusterText(
  showSkills: boolean,
  showDictation: boolean,
  showVim: boolean,
  showMode: boolean,
  input: PromptHeaderBorderLayoutInput,
) {
  let text = ""
  if (showSkills) text += input.skillsText
  if (showDictation) text += `─${input.dictationText}`
  if (showVim) text += `─${input.vimText}`
  if (showMode) text += `─${input.modeText}`
  return text
}

export function computePromptHeaderBorderLayout(input: PromptHeaderBorderLayoutInput): PromptHeaderBorderLayout {
  // Rendered shell is: "├" + <inner> + "─┤"
  const innerWidth = Math.max(0, Math.floor(input.width) - 3)
  const minFill = innerWidth > 0 ? 1 : 0

  let showContext = input.showContext && textWidth(input.contextText) > 0
  let showSkills = textWidth(input.skillsText) > 0
  let showDictation = textWidth(input.dictationText) > 0
  let showVim = input.showVim && textWidth(input.vimText) > 0
  let showMode = textWidth(input.modeText) > 0

  const leftText = () => (showContext ? `${input.contextText}─` : "")
  const rightText = () => buildRightClusterText(showSkills, showDictation, showVim, showMode, input)
  const fits = () => textWidth(leftText()) + textWidth(rightText()) + minFill <= innerWidth

  // Drop lowest-priority right metadata first.
  if (!fits() && showSkills) showSkills = false
  if (!fits() && showMode) showMode = false
  if (!fits() && showVim) showVim = false
  if (!fits() && showDictation) showDictation = false

  // Preserve the center fill even if context meter must be hidden.
  if (!fits() && showContext) showContext = false

  const fillLength = Math.max(0, innerWidth - textWidth(leftText()) - textWidth(rightText()))

  return {
    showContext,
    showSkills,
    showDictation,
    showVim,
    showMode,
    fill: "─".repeat(fillLength),
  }
}
