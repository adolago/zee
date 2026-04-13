import style from "./content-bash.module.css"
import { createResource } from "solid-js"
import { codeToHtml } from "shiki"

interface Props {
  command: string
  output: string
  description?: string
  expand?: boolean
}

export function ContentBash(props: Props) {
  const [commandHtml] = createResource(
    () => props.command,
    async (command) => {
      return codeToHtml(command || "", {
        lang: "bash",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  )

  const [outputHtml] = createResource(
    () => props.output,
    async (output) => {
      return codeToHtml(output || "", {
        lang: "console",
        themes: {
          light: "github-light",
          dark: "github-dark",
        },
      })
    },
  )

  return (
    <div class={style.root} data-expanded={true}>
      <div data-slot="body">
        <div data-slot="header">
          <span>{props.description}</span>
        </div>
        <div data-slot="content">
          <div innerHTML={commandHtml()} />
          <div data-slot="output" innerHTML={outputHtml()} />
        </div>
      </div>
    </div>
  )
}
