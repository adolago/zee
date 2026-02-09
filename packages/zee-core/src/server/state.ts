export namespace ServerState {
  export const DEFAULT_API_PORT = 3210
  let _url: URL | undefined

  export function url(): URL {
    return _url ?? new URL(`http://localhost:${DEFAULT_API_PORT}`)
  }

  export function setUrl(url: URL) {
    _url = url
  }

  export function reset() {
    _url = undefined
  }
}
