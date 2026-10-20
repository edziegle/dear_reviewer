// Just enough of `vscode` for the Dashboard, the Assistant and the overview to
// run outside VS Code, in the pages `capture.mjs` draws for the walkthrough's
// images. A webview here is a plain object that `capture.mjs` joins to a page
// of headless Chromium: what the extension posts goes to the page, and what
// the page posts comes back to the handler the extension registered.

type Listener<T> = (event: T) => unknown;

export class EventEmitter<T = void> {
  private listeners: Listener<T>[] = [];
  readonly event = (listener: Listener<T>) => {
    this.listeners.push(listener);
    return { dispose: () => undefined };
  };
  fire(event?: T): void {
    for (const listener of this.listeners) listener(event as T);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export const Uri = {
  file: (fsPath: string) => ({ fsPath, toString: () => `file://${fsPath}` }),
};

export const ViewColumn = { One: 1, Beside: -2 };

/** The webview as the extension sees it, and the two ends `capture.mjs` joins. */
export class StubWebview {
  html = "";
  options: unknown = {};
  readonly cspSource = "vscode-webview:";
  private handler: Listener<unknown> = () => undefined;
  /** Where what the extension posts goes; set once the page is open. */
  toPage: (message: unknown) => unknown = () => undefined;

  onDidReceiveMessage(handler: Listener<unknown>) {
    this.handler = handler;
    return { dispose: () => undefined };
  }

  /** Delivers what the page posted to the extension. */
  fromPage(message: unknown): void {
    this.handler(message);
  }

  postMessage(message: unknown): Thenable<boolean> {
    return Promise.resolve(this.toPage(message)).then(() => true);
  }

  asWebviewUri<T>(uri: T): T {
    return uri;
  }
}

let latest: StubWebview | undefined;

/** The webview the extension made or was given last. */
export function latestWebview(): StubWebview {
  if (!latest) throw new Error("no webview has been made");
  return latest;
}

/** A view for `resolveWebviewView`, as VS Code hands it to a provider. */
export function stubView() {
  const webview = new StubWebview();
  latest = webview;
  return {
    webview,
    visible: true,
    description: "",
    onDidChangeVisibility: new EventEmitter<void>().event,
    onDidDispose: new EventEmitter<void>().event,
  };
}

export const window = {
  createWebviewPanel(_viewType: string, title: string) {
    const webview = new StubWebview();
    latest = webview;
    return {
      webview,
      title,
      active: true,
      viewColumn: ViewColumn.One,
      onDidDispose: new EventEmitter<void>().event,
      reveal: () => undefined,
      dispose: () => undefined,
    };
  },
};

/** Nothing runs a command here; the views only ask to be focused. */
export const commands = { executeCommand: () => Promise.resolve(undefined) };
