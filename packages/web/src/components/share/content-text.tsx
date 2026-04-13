import style from "./content-text.module.css"
import { CopyButton } from "./copy-button"

interface Props {
  text: string
  expand?: boolean
  compact?: boolean
}
export function ContentText(props: Props) {
  return (
    <div class={style.root} data-expanded={true} data-compact={props.compact === true ? true : undefined}>
      <pre data-slot="text">{props.text}</pre>
      <CopyButton text={props.text} />
    </div>
  )
}
