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

  let showContext = input.showContext && input.contextText.length > 0
  let showSkills = input.skillsText.length > 0
  let showDictation = input.dictationText.length > 0
  let showVim = input.showVim && input.vimText.length > 0
  let showMode = input.modeText.length > 0

  const leftText = () => (showContext ? `${input.contextText}─` : "")
  const rightText = () => buildRightClusterText(showSkills, showDictation, showVim, showMode, input)
  const fits = () => leftText().length + rightText().length + minFill <= innerWidth

  // Drop lowest-priority right metadata first.
  if (!fits() && showSkills) showSkills = false
  if (!fits() && showMode) showMode = false
  if (!fits() && showVim) showVim = false
  if (!fits() && showDictation) showDictation = false

  // Preserve the center fill even if context meter must be hidden.
  if (!fits() && showContext) showContext = false

  const fillLength = Math.max(0, innerWidth - leftText().length - rightText().length)

  return {
    showContext,
    showSkills,
    showDictation,
    showVim,
    showMode,
    fill: "─".repeat(fillLength),
  }
}
