import style from "./content-error.module.css"
import { type JSX } from "solid-js"

interface Props extends JSX.HTMLAttributes<HTMLDivElement> {
  expand?: boolean
}
export function ContentError(props: Props) {
  return (
    <div class={style.root} data-expanded={true}>
      <div data-section="content">
        {props.children}
      </div>
    </div>
  )
}
