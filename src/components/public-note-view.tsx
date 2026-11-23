import { ChevronRight, Download, FileText, Globe } from "lucide-react";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { PublicCodeBlock, PublicToggleBlock } from "@/components/public-note-interactive";
import { siteHref } from "@/lib/hosts";
import { localeDir, type Locale } from "@/lib/i18n/locale";
import { messagesFor } from "@/lib/i18n/messages";
import { createTranslator } from "@/lib/i18n/translate";
import { isPresetCover, NOTE_COVERS, uploadedCoverPath } from "@/lib/note-document";
import { mentionText } from "@/lib/note-mention";
import { rewriteBlocksForShare, shareCoverUrl, shareIconUrl, sharePagePath } from "@/lib/note-share";
import { NoteIcon } from "@/components/note-icon";
import { isUploadedNoteIcon, noteIconText } from "@/lib/note-icon";
import type { ResolvedPublicShare } from "@/lib/note-share-server";
import { validColumnWidth } from "@/lib/note-columns";

// BlockNote のカラー名と Notion の色対応（テキスト色・背景色）。
const TEXT_COLORS: Record<string, string> = {
  gray: "#787774",
  brown: "#9f6b53",
  red: "#d44c47",
  orange: "#d9730d",
  yellow: "#cb912f",
  green: "#448361",
  blue: "#337ea9",
  purple: "#9065b0",
  pink: "#c14c8a",
};

const BG_COLORS: Record<string, string> = {
  gray: "#f1f1ef",
  brown: "#f4eeee",
  red: "#fdebec",
  orange: "#fbecdd",
  yellow: "#fbf3db",
  green: "#edf3ec",
  blue: "#e7f3f8",
  purple: "#f6f3f9",
  pink: "#faf1f5",
};

type InlineNode =
  | { type: "text"; text: string; styles?: Record<string, unknown> }
  | { type: "link"; href: string; content: InlineNode[] }
  | { type: "mention"; props?: Record<string, unknown> };

type TableCell =
  | InlineNode[]
  | {
      type: "tableCell";
      props?: {
        backgroundColor?: string;
        textColor?: string;
        textAlignment?: string;
        colspan?: number;
        rowspan?: number;
      };
      content: InlineNode[];
    };

type TableContent = {
  type: "tableContent";
  columnWidths?: (number | null | undefined)[];
  headerRows?: number;
  headerCols?: number;
  rows: { cells: TableCell[] }[];
};

type RenderBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: RenderBlock[];
};

function colorStyle(textColor?: unknown, backgroundColor?: unknown): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (typeof textColor === "string" && textColor !== "default" && TEXT_COLORS[textColor]) {
    style.color = TEXT_COLORS[textColor];
  }
  if (typeof backgroundColor === "string" && backgroundColor !== "default" && BG_COLORS[backgroundColor]) {
    style.backgroundColor = BG_COLORS[backgroundColor];
  }
  return Object.keys(style).length ? style : undefined;
}

function alignStyle(alignment: unknown): CSSProperties["textAlign"] | undefined {
  return alignment === "left" || alignment === "center" || alignment === "right" || alignment === "justify"
    ? alignment
    : undefined;
}

function renderInline(nodes: unknown): ReactNode {
  if (!Array.isArray(nodes) || !nodes.length) return null;
  return nodes.map((raw, index) => {
    const node = raw as InlineNode;
    if (node.type === "link") {
      return (
        <a key={index} href={node.href} target="_blank" rel="noopener noreferrer" className="public-note-link">
          {renderInline(node.content)}
        </a>
      );
    }
    if (node.type === "mention") {
      // 「@」メンション。リンク先のページは公開されていないことがあるので、リンクにせず文字だけ出す（タイトルは書いた時のもの）。
      return <span key={index} className="public-note-mention">{mentionText(node.props ?? {})}</span>;
    }
    if (node.type !== "text") return null;
    const styles = node.styles ?? {};
    let element: ReactNode = node.text;
    if (styles.code) element = <code className="public-note-inline-code">{element}</code>;
    if (styles.bold) element = <strong>{element}</strong>;
    if (styles.italic) element = <em>{element}</em>;
    if (styles.underline) element = <u>{element}</u>;
    if (styles.strike) element = <s>{element}</s>;
    const colors = colorStyle(styles.textColor, styles.backgroundColor);
    if (colors) {
      return (
        <span key={index} style={colors} className={colors.backgroundColor ? "public-note-highlight" : undefined}>
          {element}
        </span>
      );
    }
    return <span key={index}>{element}</span>;
  });
}

function plainText(nodes: unknown): string {
  if (!Array.isArray(nodes)) return "";
  return nodes
    .map((raw) => {
      const node = raw as InlineNode;
      if (node.type === "text") return node.text;
      if (node.type === "link") return plainText(node.content);
      if (node.type === "mention") return mentionText(node.props ?? {});
      return "";
    })
    .join("");
}

function renderBlockList(
  blocks: RenderBlock[],
  labels: { copy: string; copied: string; download: string },
): ReactNode {
  if (!blocks.length) return null;
  const elements: ReactNode[] = [];
  let numberIndex = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "numberedListItem") {
      const start = typeof block.props?.start === "number" ? block.props.start : null;
      numberIndex = start ?? (i > 0 && blocks[i - 1].type === "numberedListItem" ? numberIndex + 1 : 1);
    } else {
      numberIndex = 0;
    }
    elements.push(renderBlock(block, numberIndex, labels));
  }
  return elements;
}

function renderBlock(
  block: RenderBlock,
  numberIndex: number,
  labels: { copy: string; copied: string; download: string },
): ReactNode {
  const props = block.props ?? {};
  const colors = colorStyle(props.textColor, props.backgroundColor);
  const textAlign = alignStyle(props.textAlignment);
  const blockStyle: CSSProperties | undefined =
    colors || textAlign ? { ...colors, ...(textAlign ? { textAlign } : {}) } : undefined;
  // 段組みは段ごとに中身を描く（下の共通の子ブロックの描画は使わない。両方で描くと入れ子の段組みで仕事が倍々になる）。
  if (block.type === "columnList") {
    return (
      <div key={block.id} className="public-note-columns">
        {(block.children ?? []).filter((column) => column.type === "column").map((column) => {
          const width = column.props?.width;
          return (
            <div key={column.id} className="public-note-column" style={validColumnWidth(width) ? { flexGrow: width } : undefined}>
              {renderBlockList(column.children ?? [], labels)}
            </div>
          );
        })}
      </div>
    );
  }
  const renderedChildren =
    Array.isArray(block.children) && block.children.length > 0 ? renderBlockList(block.children, labels) : null;
  const childrenNode = renderedChildren ? <div className="public-note-children">{renderedChildren}</div> : null;

  switch (block.type) {
    case "paragraph": {
      const inline = renderInline(block.content);
      return (
        <div key={block.id} className="public-note-block public-note-paragraph" style={blockStyle}>
          <p>{inline ?? <br />}</p>
          {childrenNode}
        </div>
      );
    }
    case "heading": {
      const level = props.level === 1 || props.level === 2 || props.level === 3 ? props.level : 1;
      const inline = renderInline(block.content);
      const headingEl =
        level === 1 ? (
          <h1 className="public-note-h1">{inline}</h1>
        ) : level === 2 ? (
          <h2 className="public-note-h2">{inline}</h2>
        ) : (
          <h3 className="public-note-h3">{inline}</h3>
        );
      if (props.isToggleable) {
        return (
          <div key={block.id} className="public-note-block" style={blockStyle}>
            <PublicToggleBlock header={headingEl}>{renderedChildren}</PublicToggleBlock>
          </div>
        );
      }
      return (
        <div key={block.id} className="public-note-block" style={blockStyle}>
          {headingEl}
          {childrenNode}
        </div>
      );
    }
    case "bulletListItem":
      return (
        <div key={block.id} className="public-note-block public-note-list-item" style={blockStyle}>
          <div className="public-note-list-row">
            <span className="public-note-bullet" aria-hidden="true">•</span>
            <div className="public-note-list-text">{renderInline(block.content)}</div>
          </div>
          {childrenNode}
        </div>
      );
    case "numberedListItem":
      return (
        <div key={block.id} className="public-note-block public-note-list-item" style={blockStyle}>
          <div className="public-note-list-row">
            <span className="public-note-number" aria-hidden="true">{numberIndex}.</span>
            <div className="public-note-list-text">{renderInline(block.content)}</div>
          </div>
          {childrenNode}
        </div>
      );
    case "checkListItem": {
      const checked = props.checked === true;
      return (
        <div key={block.id} className={`public-note-block public-note-check-item ${checked ? "is-checked" : ""}`} style={blockStyle}>
          <div className="public-note-list-row">
            <input type="checkbox" checked={checked} readOnly tabIndex={-1} className="public-note-checkbox" aria-label="" />
            <div className="public-note-list-text">{renderInline(block.content)}</div>
          </div>
          {childrenNode}
        </div>
      );
    }
    case "toggleListItem":
      return (
        <div key={block.id} className="public-note-block" style={blockStyle}>
          <PublicToggleBlock header={<div className="public-note-list-text">{renderInline(block.content)}</div>}>
            {renderedChildren}
          </PublicToggleBlock>
        </div>
      );
    case "quote":
      return (
        <div key={block.id} className="public-note-block" style={blockStyle}>
          <blockquote className="public-note-quote">{renderInline(block.content)}</blockquote>
          {childrenNode}
        </div>
      );
    case "callout": {
      const emoji = typeof props.emoji === "string" && props.emoji ? props.emoji : "💡";
      const calloutBg = typeof props.backgroundColor === "string" ? props.backgroundColor : "gray";
      const calloutStyle = colorStyle(props.textColor, calloutBg);
      return (
        <div key={block.id} className="public-note-block">
          <div className={`public-note-callout ${calloutBg === "default" ? "is-outlined" : ""}`} style={calloutStyle}>
            <span className="public-note-callout-emoji" aria-hidden="true">{emoji}</span>
            <div className="public-note-callout-body">
              <div>{renderInline(block.content)}</div>
              {childrenNode}
            </div>
          </div>
        </div>
      );
    }
    case "codeBlock": {
      const language = typeof props.language === "string" ? props.language : "text";
      const code = plainText(block.content);
      return (
        <div key={block.id} className="public-note-block">
          <PublicCodeBlock code={code} language={language} copyLabel={labels.copy} copiedLabel={labels.copied} />
          {childrenNode}
        </div>
      );
    }
    case "divider":
      return (
        <div key={block.id} className="public-note-block">
          <hr className="public-note-divider" />
          {childrenNode}
        </div>
      );
    case "table": {
      const table = block.content as TableContent | undefined;
      if (!table || table.type !== "tableContent" || !Array.isArray(table.rows)) return null;
      const headerRows = typeof table.headerRows === "number" ? table.headerRows : 0;
      const headerCols = typeof table.headerCols === "number" ? table.headerCols : 0;
      return (
        <div key={block.id} className="public-note-block public-note-table-wrap">
          <table className="public-note-table">
            {Array.isArray(table.columnWidths) && table.columnWidths.some((w) => typeof w === "number") ? (
              <colgroup>
                {table.columnWidths.map((w, idx) => (
                  <col key={idx} style={typeof w === "number" ? { width: `${w}px` } : undefined} />
                ))}
              </colgroup>
            ) : null}
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.cells.map((rawCell, colIndex) => {
                    const isObj = !Array.isArray(rawCell) && rawCell?.type === "tableCell";
                    const cellContent = isObj ? rawCell.content : (rawCell as InlineNode[]);
                    const cellProps = isObj ? rawCell.props : undefined;
                    const isHeader = rowIndex < headerRows || colIndex < headerCols;
                    const cellColors = colorStyle(cellProps?.textColor, cellProps?.backgroundColor);
                    const cellAlign = alignStyle(cellProps?.textAlignment);
                    const cellStyle: CSSProperties | undefined =
                      cellColors || cellAlign ? { ...cellColors, ...(cellAlign ? { textAlign: cellAlign } : {}) } : undefined;
                    const Tag = isHeader ? "th" : "td";
                    return (
                      <Tag
                        key={colIndex}
                        colSpan={cellProps?.colspan && cellProps.colspan > 1 ? cellProps.colspan : undefined}
                        rowSpan={cellProps?.rowspan && cellProps.rowspan > 1 ? cellProps.rowspan : undefined}
                        style={cellStyle}
                      >
                        {renderInline(cellContent)}
                      </Tag>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "image": {
      const url = typeof props.url === "string" ? props.url : "";
      if (!url) return childrenNode ? <div key={block.id} className="public-note-block">{childrenNode}</div> : null;
      const caption = typeof props.caption === "string" ? props.caption : "";
      const name = typeof props.name === "string" && props.name ? props.name : "image";
      if (props.showPreview === false) {
        return (
          <div key={block.id} className="public-note-block">
            <a href={url} target="_blank" rel="noopener noreferrer" className="public-note-file">
              <FileText size={18} aria-hidden="true" className="shrink-0 text-[var(--notion-muted)]" />
              <span className="min-w-0 flex-1 truncate">{name}</span>
              <span className="public-note-file-download">
                <Download size={15} aria-hidden="true" />
                <span>{labels.download}</span>
              </span>
            </a>
            {caption ? <p className="public-note-caption">{caption}</p> : null}
            {childrenNode}
          </div>
        );
      }
      const width = typeof props.previewWidth === "number" ? props.previewWidth : undefined;
      return (
        <figure key={block.id} className="public-note-block public-note-figure">
          {/* eslint-disable-next-line @next/next/no-img-element -- 公開共有トークン経由のメディアエンドポイントから配信 */}
          <img src={url} alt={caption} className="public-note-image" style={width ? { maxWidth: `min(100%, ${width}px)` } : undefined} />
          {caption ? <figcaption className="public-note-caption">{caption}</figcaption> : null}
          {childrenNode}
        </figure>
      );
    }
    case "file": {
      const url = typeof props.url === "string" ? props.url : "";
      if (!url) return childrenNode ? <div key={block.id} className="public-note-block">{childrenNode}</div> : null;
      const name = typeof props.name === "string" && props.name ? props.name : "file";
      const caption = typeof props.caption === "string" ? props.caption : "";
      return (
        <div key={block.id} className="public-note-block">
          <a href={url} download={name} className="public-note-file">
            <FileText size={18} aria-hidden="true" className="shrink-0 text-[var(--notion-muted)]" />
            <span className="min-w-0 flex-1 truncate">{name}</span>
            <span className="public-note-file-download">
              <Download size={15} aria-hidden="true" />
              <span>{labels.download}</span>
            </span>
          </a>
          {caption ? <p className="public-note-caption">{caption}</p> : null}
          {childrenNode}
        </div>
      );
    }
    default:
      return null;
  }
}

export function PublicNoteView({ data, locale }: { data: ResolvedPublicShare; locale: Locale }) {
  const t = createTranslator(messagesFor(locale));
  const dir = localeDir(locale);
  const { page, breadcrumbs, children, token, root } = data;
  const preset = isPresetCover(page.cover) ? NOTE_COVERS[page.cover] : null;
  const uploadedCover = uploadedCoverPath(page.cover);
  const coverUrl = uploadedCover ? shareCoverUrl(token, page.id) : null;
  const hasCover = Boolean(preset || coverUrl);
  const position = page.coverPosition ?? 50;

  const blocks = rewriteBlocksForShare(
    Array.isArray(page.blocks) ? (page.blocks as RenderBlock[]) : [],
    token,
    page.id,
  );

  const pageClass = [
    page.fullWidth ? "is-full-width" : "",
    page.smallText ? "is-small-text" : "",
    page.font !== "default" ? `notes-font-${page.font}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const homeHref = siteHref("/?intro");

  return (
    <div className={`public-note-shell ${pageClass}`} lang={locale} dir={dir}>
      <header className="public-note-topbar">
        <nav className="public-note-breadcrumbs" aria-label={t("Breadcrumb")}>
          {breadcrumbs.map((crumb, index) => {
            const href = crumb.id === root.id ? sharePagePath(token) : sharePagePath(token, crumb.id);
            const isCurrent = index === breadcrumbs.length - 1;
            const title = crumb.title.trim() || t("Untitled");
            return (
              <span key={crumb.id} className="public-note-crumb-item">
                {index > 0 ? <ChevronRight size={14} className="public-note-crumb-sep rtl-mirror" aria-hidden="true" /> : null}
                {isCurrent ? (
                  <span className="public-note-crumb is-current">
                    {crumb.icon ? <span className="public-note-crumb-icon" aria-hidden="true"><NoteIcon icon={noteIconText(crumb.icon)} imageUrl={isUploadedNoteIcon(crumb.icon) ? shareIconUrl(token, crumb.id) : null} /></span> : <FileText size={14} className="public-note-crumb-icon" aria-hidden="true" />}
                    <span className="truncate">{title}</span>
                  </span>
                ) : (
                  <Link href={href} className="public-note-crumb">
                    {crumb.icon ? <span className="public-note-crumb-icon" aria-hidden="true"><NoteIcon icon={noteIconText(crumb.icon)} imageUrl={isUploadedNoteIcon(crumb.icon) ? shareIconUrl(token, crumb.id) : null} /></span> : <FileText size={14} className="public-note-crumb-icon" aria-hidden="true" />}
                    <span className="truncate">{title}</span>
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
        <a href={homeHref} className="public-note-brand">
          <Globe size={14} aria-hidden="true" />
          <span>{t("Made with NoteFable")}</span>
        </a>
      </header>

      <main className="public-note-main">
        <div className={`notes-page-header ${hasCover ? "has-cover" : ""} ${page.icon ? "has-icon" : ""}`}>
          {hasCover ? (
            <div className="notes-cover" style={preset ? { background: preset } : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element -- 公開共有トークン経由のカバー配信 */}
              {coverUrl ? <img src={coverUrl} alt="" className="notes-cover-image" style={{ objectPosition: `center ${position}%` }} /> : null}
            </div>
          ) : null}
          <div className="notes-column notes-header-inner">
            {page.icon ? (
              <div className="notes-icon-wrap">
                <div className="notes-icon public-note-icon" aria-hidden="true"><NoteIcon icon={noteIconText(page.icon)} imageUrl={isUploadedNoteIcon(page.icon) ? shareIconUrl(token, page.id) : null} /></div>
              </div>
            ) : null}
            <h1 className="notes-title public-note-title">{page.title.trim() || t("Untitled")}</h1>
          </div>
        </div>

        <article className="notes-column notes-body public-note-body">
          {renderBlockList(blocks, { copy: t("Copy"), copied: t("Copied"), download: t("Download") })}
        </article>

        {children.length > 0 ? (
          <section className="notes-column public-note-subpages" aria-label={t("Sub-pages")}>
            <h2 className="public-note-subpages-heading">{t("Sub-pages")}</h2>
            <ul className="public-note-subpages-list">
              {children.map((child) => (
                <li key={child.id}>
                  <Link href={sharePagePath(token, child.id)} className="public-note-subpage-link">
                    <span className="public-note-subpage-icon" aria-hidden="true">
                      <NoteIcon icon={noteIconText(child.icon)} imageUrl={isUploadedNoteIcon(child.icon) ? shareIconUrl(token, child.id) : null} fallback={<FileText size={16} />} />
                    </span>
                    <span className="min-w-0 flex-1 truncate">{child.title.trim() || t("Untitled")}</span>
                    <ChevronRight size={15} className="public-note-subpage-arrow rtl-mirror" aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}

export function PublicNoteUnavailable({ locale }: { locale: Locale }) {
  const t = createTranslator(messagesFor(locale));
  const dir = localeDir(locale);
  const homeHref = siteHref("/?intro");
  return (
    <div className="public-note-unavailable" lang={locale} dir={dir}>
      <div className="public-note-unavailable-card">
        <FileText size={32} strokeWidth={1.5} className="text-[var(--notion-faint)]" aria-hidden="true" />
        <h1>{t("This page is not available")}</h1>
        <p>{t("It may have been unpublished, expired, or removed.")}</p>
        <a href={homeHref} className="notion-button">{t("Go to NoteFable")}</a>
      </div>
    </div>
  );
}
