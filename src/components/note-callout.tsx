"use client";

import { defaultProps } from "@blocknote/core";
import { createReactBlockSpec } from "@blocknote/react";
import { useRef, useState } from "react";
import { FloatingEmojiPopover, floatingPositionFor, usePickerBackToClose, type FloatingPosition } from "@/components/emoji-picker";
import { useT } from "@/components/i18n-provider";
import { DEFAULT_CALLOUT_EMOJI } from "@/lib/note-markdown";

// Notion のコールアウト: 絵文字と本文を、色付きの角丸の枠に入れる。絵文字を押すと選び直せる。
// 背景色はブロックの色（既定は灰色）で、ハンドルの「Color」から変えられる。
export const createCalloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: { textColor: defaultProps.textColor, backgroundColor: { default: "gray" }, emoji: { default: DEFAULT_CALLOUT_EMOJI } },
    content: "inline",
  },
  {
    render: function Callout({ block, editor, contentRef }) {
      const t = useT();
      const [position, setPosition] = useState<FloatingPosition | null>(null);
      const trigger = useRef<HTMLButtonElement | null>(null);
      const close = () => setPosition(null);
      // 端末の「戻る」は、エディターを閉じる前にこの選択画面だけを閉じる。
      usePickerBackToClose(position !== null, close);
      return <div className="notes-callout">
        <button ref={trigger} type="button" contentEditable={false} className="notes-callout-emoji"
          aria-label={t("Change icon")} title={t("Change icon")} aria-haspopup="dialog" aria-expanded={position !== null}
          // 押しても本文の選択とキャレットを動かさない。
          onMouseDown={(event) => event.preventDefault()}
          // 編集できない間（作成・削除の処理中など）は開かない。このブロックは editable の切り替えでは描き直されないので、押した時に確かめる。
          onClick={() => setPosition(position || !trigger.current || !editor.isEditable ? null : floatingPositionFor(trigger.current.getBoundingClientRect()))}>
          {block.props.emoji}
        </button>
        <div className="notes-callout-text" ref={contentRef} />
        {position && <FloatingEmojiPopover position={position} trigger={trigger} current={block.props.emoji}
          // 「Remove」は既定の絵文字に戻す（絵文字のないコールアウトは作らない）。
          onChange={(icon) => { if (editor.isEditable && editor.getBlock(block.id)) editor.updateBlock(block.id, { props: { emoji: icon ?? DEFAULT_CALLOUT_EMOJI } }); }}
          onClose={close} />}
      </div>;
    },
  },
);
