import { createMemo, createSignal, For, type JSX, Match, Show, Switch } from "solid-js";
import { Dynamic } from "solid-js/web";
import { copyText } from "../clipboard";
import { t } from "../i18n";
import { type MarkdownBlock, type MarkdownList, parseMarkdown, tableToTsv } from "../markdown";

interface RichMarkdownProps {
  body: string;
  /** Renders inline text: links, @coworker tags, bold and inline code. */
  inline: (text: string) => JSX.Element;
}

function isBlockEqual(a: MarkdownBlock, b: MarkdownBlock): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "paragraph":
      return a.text === (b as typeof a).text;
    case "code":
      return (
        a.language === (b as typeof a).language &&
        a.code === (b as typeof a).code &&
        a.closed === (b as typeof a).closed
      );
    case "heading":
      return a.level === (b as typeof a).level && a.text === (b as typeof a).text;
    case "rule":
      return true;
    default:
      return JSON.stringify(a) === JSON.stringify(b);
  }
}

/** Block-level rendering of a reply. Parsed once per body change (memoised and block-stabilized while streaming). */
export function RichMarkdown(props: RichMarkdownProps) {
  const blocks = createMemo<MarkdownBlock[]>((prev = []) => {
    const next = parseMarkdown(props.body);
    if (!prev || prev.length === 0) return next;
    return next.map((newBlock, i) => {
      const oldBlock = prev[i];
      if (oldBlock && isBlockEqual(oldBlock, newBlock)) {
        return oldBlock;
      }
      return newBlock;
    });
  });
  return (
    <div class="rich-markdown">
      <Blocks blocks={blocks()} inline={props.inline} />
    </div>
  );
}

function Blocks(props: { blocks: MarkdownBlock[]; inline: RichMarkdownProps["inline"] }) {
  return (
    <For each={props.blocks}>
      {(block) => (
        <Switch>
          <Match when={block.type === "heading" && block}>
            {(heading) => (
              <Dynamic
                component={`h${Math.min(heading().level + 2, 6)}`}
                class={`md-heading md-heading-${Math.min(heading().level, 4)}`}
              >
                {props.inline(heading().text)}
              </Dynamic>
            )}
          </Match>
          <Match when={block.type === "paragraph" && block}>
            {(paragraph) => <p class="md-paragraph">{props.inline(paragraph().text)}</p>}
          </Match>
          <Match when={block.type === "code" && block}>
            {(code) => <CodeBlock language={code().language} code={code().code} />}
          </Match>
          <Match when={block.type === "list" && block}>
            {(list) => <ListView list={list().list} inline={props.inline} />}
          </Match>
          <Match when={block.type === "table" && block}>
            {(table) => (
              <TableView
                header={table().header}
                align={table().align}
                rows={table().rows}
                inline={props.inline}
              />
            )}
          </Match>
          <Match when={block.type === "quote" && block}>
            {(quote) => (
              <blockquote class="md-quote">
                <Blocks blocks={quote().blocks} inline={props.inline} />
              </blockquote>
            )}
          </Match>
          <Match when={block.type === "rule"}>
            <hr class="md-rule" />
          </Match>
        </Switch>
      )}
    </For>
  );
}

function ListView(props: { list: MarkdownList; inline: RichMarkdownProps["inline"] }) {
  const items = () => (
    <For each={props.list.items}>
      {(item) => (
        <li classList={{ "md-task": item.checked !== null, "md-task-done": item.checked === true }}>
          <Show when={item.checked !== null}>
            <span
              class="md-checkbox"
              role="img"
              aria-label={item.checked ? t("mdDone") : t("mdNotDone")}
            >
              {item.checked ? "✓" : ""}
            </span>
          </Show>
          <span class="md-item-text">{props.inline(item.text)}</span>
          <For each={item.children}>
            {(child) => <ListView list={child} inline={props.inline} />}
          </For>
        </li>
      )}
    </For>
  );
  return (
    <Show when={props.list.ordered} fallback={<ul class="md-list">{items()}</ul>}>
      <ol class="md-list" start={props.list.start}>
        {items()}
      </ol>
    </Show>
  );
}

function TableView(props: {
  header: string[];
  align: Array<"left" | "center" | "right" | null>;
  rows: string[][];
  inline: RichMarkdownProps["inline"];
}) {
  return (
    <figure class="md-table">
      <div class="md-block-bar">
        <span>
          {t("mdTableSize", {
            rows: String(props.rows.length),
            columns: String(props.header.length),
          })}
        </span>
        <CopyButton label={t("mdCopyTable")} text={() => tableToTsv(props.header, props.rows)} />
      </div>
      <div class="md-table-scroll">
        <table>
          <thead>
            <tr>
              <For each={props.header}>
                {(cell, column) => (
                  <th style={{ "text-align": props.align[column()] ?? "left" }}>
                    {props.inline(cell)}
                  </th>
                )}
              </For>
            </tr>
          </thead>
          <tbody>
            <For each={props.rows}>
              {(row) => (
                <tr>
                  <For each={row}>
                    {(cell, column) => (
                      <td style={{ "text-align": props.align[column()] ?? "left" }}>
                        {props.inline(cell)}
                      </td>
                    )}
                  </For>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function CodeBlock(props: { language: string; code: string }) {
  return (
    <figure class="md-code">
      <div class="md-block-bar">
        <span>{props.language || t("mdCode")}</span>
        <CopyButton label={t("mdCopyCode")} text={() => props.code} />
      </div>
      <pre>
        <code>{props.code}</code>
      </pre>
    </figure>
  );
}

function CopyButton(props: { label: string; text: () => string }) {
  const [state, setState] = createSignal<"idle" | "copied" | "failed">("idle");
  async function copy() {
    try {
      await copyText(props.text());
      setState("copied");
    } catch {
      setState("failed");
    }
    window.setTimeout(() => setState("idle"), 1_400);
  }
  return (
    <button type="button" class="md-copy" onClick={() => void copy()} aria-live="polite">
      {state() === "copied" ? t("copied") : state() === "failed" ? t("copyFailed") : props.label}
    </button>
  );
}
