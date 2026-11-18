import type { Dictionary } from "@blocknote/core";

// Full BlockNote UI dictionaries for enabled locales not shipped in @blocknote/core/locales.
export const blockNoteId: Dictionary = {
  "slash_menu": {
    "heading": {
      "title": "Judul 1",
      "subtext": "Judul tingkat teratas",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "judul",
        "judul1",
        "judul 1"
      ],
      "group": "Judul"
    },
    "heading_2": {
      "title": "Judul 2",
      "subtext": "Judul bagian utama",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "judul",
        "judul2",
        "judul 2",
        "subjudul"
      ],
      "group": "Judul"
    },
    "heading_3": {
      "title": "Judul 3",
      "subtext": "Judul subbagian dan grup",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "judul",
        "judul3",
        "judul 3",
        "subjudul"
      ],
      "group": "Judul"
    },
    "heading_4": {
      "title": "Judul 4",
      "subtext": "Judul subbagian kecil",
      "aliases": [
        "h4",
        "heading4",
        "subheading4",
        "judul4",
        "judul 4",
        "subjudul4"
      ],
      "group": "Subjudul"
    },
    "heading_5": {
      "title": "Judul 5",
      "subtext": "Judul subbagian lebih kecil",
      "aliases": [
        "h5",
        "heading5",
        "subheading5",
        "judul5",
        "judul 5",
        "subjudul5"
      ],
      "group": "Subjudul"
    },
    "heading_6": {
      "title": "Judul 6",
      "subtext": "Judul tingkat paling bawah",
      "aliases": [
        "h6",
        "heading6",
        "subheading6",
        "judul6",
        "judul 6",
        "subjudul6"
      ],
      "group": "Subjudul"
    },
    "toggle_heading": {
      "title": "Judul Lipat 1",
      "subtext": "Judul tingkat teratas yang dapat dilipat",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "collapsable",
        "judul",
        "judul 1",
        "lipat",
        "toggle"
      ],
      "group": "Subjudul"
    },
    "toggle_heading_2": {
      "title": "Judul Lipat 2",
      "subtext": "Judul bagian utama yang dapat dilipat",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "collapsable",
        "judul 2",
        "subjudul",
        "lipat",
        "toggle"
      ],
      "group": "Subjudul"
    },
    "toggle_heading_3": {
      "title": "Judul Lipat 3",
      "subtext": "Judul subbagian dan grup yang dapat dilipat",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "collapsable",
        "judul 3",
        "subjudul",
        "lipat",
        "toggle"
      ],
      "group": "Subjudul"
    },
    "quote": {
      "title": "Kutipan",
      "subtext": "Kutipan atau petikan teks",
      "aliases": [
        "quotation",
        "blockquote",
        "bq",
        "kutipan"
      ],
      "group": "Blok dasar"
    },
    "toggle_list": {
      "title": "Daftar Lipat",
      "subtext": "Daftar dengan sub-item yang dapat disembunyikan",
      "aliases": [
        "li",
        "list",
        "toggleList",
        "toggle list",
        "collapsable list",
        "daftar",
        "daftar lipat",
        "lipat"
      ],
      "group": "Blok dasar"
    },
    "numbered_list": {
      "title": "Daftar Bernomor",
      "subtext": "Daftar dengan item berurutan",
      "aliases": [
        "ol",
        "li",
        "list",
        "numberedlist",
        "numbered list",
        "daftar",
        "daftar bernomor",
        "nomor"
      ],
      "group": "Blok dasar"
    },
    "bullet_list": {
      "title": "Daftar Poin",
      "subtext": "Daftar dengan poin tanpa urutan",
      "aliases": [
        "ul",
        "li",
        "list",
        "bulletlist",
        "bullet list",
        "daftar",
        "daftar poin",
        "poin"
      ],
      "group": "Blok dasar"
    },
    "check_list": {
      "title": "Daftar Tugas",
      "subtext": "Daftar dengan kotak centang",
      "aliases": [
        "ul",
        "li",
        "list",
        "checklist",
        "check list",
        "checked list",
        "checkbox",
        "daftar tugas",
        "centang",
        "todo"
      ],
      "group": "Blok dasar"
    },
    "paragraph": {
      "title": "Paragraf",
      "subtext": "Teks isi dokumen Anda",
      "aliases": [
        "p",
        "paragraph",
        "paragraf",
        "teks"
      ],
      "group": "Blok dasar"
    },
    "code_block": {
      "title": "Blok Kode",
      "subtext": "Blok kode dengan penyorotan sintaks",
      "aliases": [
        "code",
        "pre",
        "kode",
        "blok kode"
      ],
      "group": "Blok dasar"
    },
    "page_break": {
      "title": "Pemisah Halaman",
      "subtext": "Pemisah antarhalaman",
      "aliases": [
        "page",
        "break",
        "separator",
        "halaman",
        "pemisah halaman"
      ],
      "group": "Blok dasar"
    },
    "table": {
      "title": "Tabel",
      "subtext": "Tabel dengan sel yang dapat diedit",
      "aliases": [
        "table",
        "tabel"
      ],
      "group": "Lanjutan"
    },
    "image": {
      "title": "Gambar",
      "subtext": "Gambar yang dapat diubah ukurannya dengan keterangan",
      "aliases": [
        "image",
        "imageUpload",
        "upload",
        "img",
        "picture",
        "media",
        "url",
        "gambar",
        "foto",
        "unggah"
      ],
      "group": "Media"
    },
    "video": {
      "title": "Video",
      "subtext": "Video yang dapat diubah ukurannya dengan keterangan",
      "aliases": [
        "video",
        "videoUpload",
        "upload",
        "mp4",
        "film",
        "media",
        "url",
        "unggah"
      ],
      "group": "Media"
    },
    "audio": {
      "title": "Audio",
      "subtext": "Audio tersemat dengan keterangan",
      "aliases": [
        "audio",
        "audioUpload",
        "upload",
        "mp3",
        "sound",
        "media",
        "url",
        "suara",
        "unggah"
      ],
      "group": "Media"
    },
    "file": {
      "title": "File",
      "subtext": "File tersemat",
      "aliases": [
        "file",
        "upload",
        "embed",
        "media",
        "url",
        "berkas",
        "unggah",
        "sematkan"
      ],
      "group": "Media"
    },
    "emoji": {
      "title": "Emoji",
      "subtext": "Cari dan sisipkan emoji",
      "aliases": [
        "emoji",
        "emote",
        "emotion",
        "face",
        "ekspresi",
        "wajah"
      ],
      "group": "Lainnya"
    },
    "divider": {
      "title": "Garis Pemisah",
      "subtext": "Memisahkan blok secara visual",
      "aliases": [
        "divider",
        "hr",
        "line",
        "horizontal rule",
        "pemisah",
        "garis"
      ],
      "group": "Blok dasar"
    }
  },
  "placeholders": {
    "default": "Ketik teks atau ketik '/' untuk perintah",
    "heading": "Judul",
    "toggleListItem": "Daftar lipat",
    "bulletListItem": "Daftar",
    "numberedListItem": "Daftar",
    "checkListItem": "Daftar",
    "new_comment": "Tulis komentar...",
    "edit_comment": "Edit komentar...",
    "comment_reply": "Tambahkan komentar..."
  },
  "file_blocks": {
    "add_button_text": {
      "image": "Tambahkan gambar",
      "video": "Tambahkan video",
      "audio": "Tambahkan audio",
      "file": "Tambahkan file"
    }
  },
  "toggle_blocks": {
    "add_block_button": "Bagian lipat kosong. Klik untuk menambahkan blok."
  },
  "code_block": {
    "add_source_button_text": "Tambahkan kode sumber",
    "ok_button_text": "Oke"
  },
  "side_menu": {
    "add_block_label": "Tambahkan blok",
    "drag_handle_label": "Buka menu blok"
  },
  "drag_handle": {
    "delete_menuitem": "Hapus",
    "colors_menuitem": "Warna",
    "header_row_menuitem": "Baris judul",
    "header_column_menuitem": "Kolom judul"
  },
  "table_handle": {
    "delete_column_menuitem": "Hapus kolom",
    "delete_row_menuitem": "Hapus baris",
    "add_left_menuitem": "Tambahkan kolom di kiri",
    "add_right_menuitem": "Tambahkan kolom di kanan",
    "add_above_menuitem": "Tambahkan baris di atas",
    "add_below_menuitem": "Tambahkan baris di bawah",
    "split_cell_menuitem": "Pisahkan sel",
    "merge_cells_menuitem": "Gabungkan sel",
    "background_color_menuitem": "Warna latar belakang"
  },
  "suggestion_menu": {
    "no_items_title": "Tidak ada item ditemukan"
  },
  "color_picker": {
    "text_title": "Teks",
    "background_title": "Latar belakang",
    "colors": {
      "default": "Otomatis",
      "gray": "Abu-abu",
      "brown": "Cokelat",
      "red": "Merah",
      "orange": "Oranye",
      "yellow": "Kuning",
      "green": "Hijau",
      "blue": "Biru",
      "purple": "Ungu",
      "pink": "Merah muda"
    }
  },
  "formatting_toolbar": {
    "bold": {
      "tooltip": "Tebal",
      "secondary_tooltip": "Mod+B"
    },
    "italic": {
      "tooltip": "Miring",
      "secondary_tooltip": "Mod+I"
    },
    "underline": {
      "tooltip": "Garis bawah",
      "secondary_tooltip": "Mod+U"
    },
    "strike": {
      "tooltip": "Coret",
      "secondary_tooltip": "Mod+Shift+S"
    },
    "code": {
      "tooltip": "Kode",
      "secondary_tooltip": "Kode sebaris"
    },
    "colors": {
      "tooltip": "Warna"
    },
    "link": {
      "tooltip": "Buat tautan",
      "secondary_tooltip": "Mod+K"
    },
    "file_caption": {
      "tooltip": "Edit keterangan",
      "input_placeholder": "Edit keterangan"
    },
    "file_replace": {
      "tooltip": {
        "image": "Ganti gambar",
        "video": "Ganti video",
        "audio": "Ganti audio",
        "file": "Ganti file"
      }
    },
    "file_rename": {
      "tooltip": {
        "image": "Ganti nama gambar",
        "video": "Ganti nama video",
        "audio": "Ganti nama audio",
        "file": "Ganti nama file"
      },
      "input_placeholder": {
        "image": "Ganti nama gambar",
        "video": "Ganti nama video",
        "audio": "Ganti nama audio",
        "file": "Ganti nama file"
      }
    },
    "file_download": {
      "tooltip": {
        "image": "Unduh gambar",
        "video": "Unduh video",
        "audio": "Unduh audio",
        "file": "Unduh file"
      }
    },
    "file_delete": {
      "tooltip": {
        "image": "Hapus gambar",
        "video": "Hapus video",
        "audio": "Hapus audio",
        "file": "Hapus file"
      }
    },
    "file_preview_toggle": {
      "tooltip": "Tampilkan/sembunyikan pratinjau"
    },
    "nest": {
      "tooltip": "Jorokkan blok ke dalam",
      "secondary_tooltip": "Tab"
    },
    "unnest": {
      "tooltip": "Keluarkan inden blok",
      "secondary_tooltip": "Shift+Tab"
    },
    "align_left": {
      "tooltip": "Rata kiri"
    },
    "align_center": {
      "tooltip": "Rata tengah"
    },
    "align_right": {
      "tooltip": "Rata kanan"
    },
    "align_justify": {
      "tooltip": "Rata kanan-kiri"
    },
    "table_cell_merge": {
      "tooltip": "Gabungkan sel"
    },
    "comment": {
      "tooltip": "Tambahkan komentar"
    }
  },
  "file_panel": {
    "upload": {
      "title": "Unggah",
      "file_placeholder": {
        "image": "Unggah gambar",
        "video": "Unggah video",
        "audio": "Unggah audio",
        "file": "Unggah file"
      },
      "upload_error": "Kesalahan: Gagal mengunggah"
    },
    "embed": {
      "title": "Sematkan",
      "embed_button": {
        "image": "Sematkan gambar",
        "video": "Sematkan video",
        "audio": "Sematkan audio",
        "file": "Sematkan file"
      },
      "url_placeholder": "Masukkan URL"
    }
  },
  "link_toolbar": {
    "delete": {
      "tooltip": "Hapus tautan"
    },
    "edit": {
      "text": "Edit tautan",
      "tooltip": "Edit"
    },
    "open": {
      "tooltip": "Buka di tab baru"
    },
    "form": {
      "title_placeholder": "Edit judul",
      "url_placeholder": "Edit URL"
    }
  },
  "comments": {
    "edited": "diedit",
    "save_button_text": "Simpan",
    "cancel_button_text": "Batal",
    "deleted_reference_text": "Konten asli dihapus",
    "discard_pending_comment": "Yakin ingin membuang komentar ini?",
    "actions": {
      "add_reaction": "Tambahkan reaksi",
      "resolve": "Selesaikan",
      "reopen": "Buka kembali",
      "edit_comment": "Edit komentar",
      "delete_comment": "Hapus komentar",
      "more_actions": "Tindakan lainnya"
    },
    "reactions": {
      "reacted_by": "Direaksi oleh"
    },
    "sidebar": {
      "marked_as_resolved": "Ditandai sebagai selesai",
      "more_replies": (count: number) => `${count} balasan lainnya`
    }
  },
  "suggestion_changes": {
    "formatting_change": "Perubahan Format",
    "deleted": "Dihapus",
    "inserted_by": (users: string) => `Disisipkan oleh: ${users}`,
    "deleted_by": (users: string) => `Dihapus oleh: ${users}`,
    "formatting_change_by": (formats: string, users: string) => `Perubahan pemformatan (${formats}) oleh: ${users}`
  },
  "exporter": {
    "open_file": "Buka file",
    "open_video_file": "Buka video",
    "open_audio_file": "Buka audio"
  },
  "generic": {
    "ctrl_shortcut": "Ctrl",
    "form_submit": "Oke"
  }
};

export const blockNoteTh: Dictionary = {
  "slash_menu": {
    "heading": {
      "title": "หัวข้อ 1",
      "subtext": "หัวข้อระดับบนสุด",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "หัวข้อ",
        "หัวข้อ 1"
      ],
      "group": "หัวข้อ"
    },
    "heading_2": {
      "title": "หัวข้อ 2",
      "subtext": "หัวข้อส่วนสำคัญ",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "หัวข้อ",
        "หัวข้อ 2",
        "หัวข้อรอง"
      ],
      "group": "หัวข้อ"
    },
    "heading_3": {
      "title": "หัวข้อ 3",
      "subtext": "หัวข้อย่อยและหัวข้อกลุ่ม",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "หัวข้อ",
        "หัวข้อ 3",
        "หัวข้อย่อย"
      ],
      "group": "หัวข้อ"
    },
    "heading_4": {
      "title": "หัวข้อ 4",
      "subtext": "หัวข้อย่อยระดับรอง",
      "aliases": [
        "h4",
        "heading4",
        "subheading4",
        "หัวข้อ 4"
      ],
      "group": "หัวข้อรอง"
    },
    "heading_5": {
      "title": "หัวข้อ 5",
      "subtext": "หัวข้อย่อยขนาดเล็ก",
      "aliases": [
        "h5",
        "heading5",
        "subheading5",
        "หัวข้อ 5"
      ],
      "group": "หัวข้อรอง"
    },
    "heading_6": {
      "title": "หัวข้อ 6",
      "subtext": "หัวข้อระดับต่ำสุด",
      "aliases": [
        "h6",
        "heading6",
        "subheading6",
        "หัวข้อ 6"
      ],
      "group": "หัวข้อรอง"
    },
    "toggle_heading": {
      "title": "หัวข้อแบบยุบได้ 1",
      "subtext": "หัวข้อระดับบนสุดที่ซ่อนหรือแสดงเนื้อหาได้",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "collapsable",
        "หัวข้อ",
        "หัวข้อแบบยุบได้",
        "ยุบ"
      ],
      "group": "หัวข้อรอง"
    },
    "toggle_heading_2": {
      "title": "หัวข้อแบบยุบได้ 2",
      "subtext": "หัวข้อส่วนสำคัญที่ซ่อนหรือแสดงเนื้อหาได้",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "collapsable",
        "หัวข้อ 2",
        "หัวข้อแบบยุบได้",
        "ยุบ"
      ],
      "group": "หัวข้อรอง"
    },
    "toggle_heading_3": {
      "title": "หัวข้อแบบยุบได้ 3",
      "subtext": "หัวข้อย่อยที่ซ่อนหรือแสดงเนื้อหาได้",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "collapsable",
        "หัวข้อ 3",
        "หัวข้อแบบยุบได้",
        "ยุบ"
      ],
      "group": "หัวข้อรอง"
    },
    "quote": {
      "title": "คำพูดยกมา",
      "subtext": "ข้อความอ้างอิงหรือคำพูดยกมา",
      "aliases": [
        "quotation",
        "blockquote",
        "bq",
        "คำพูดยกมา",
        "อ้างอิง"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "toggle_list": {
      "title": "รายการแบบยุบได้",
      "subtext": "รายการที่ซ่อนข้อย่อยได้",
      "aliases": [
        "li",
        "list",
        "toggleList",
        "toggle list",
        "collapsable list",
        "รายการ",
        "รายการแบบยุบได้",
        "ยุบ"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "numbered_list": {
      "title": "รายการลำดับเลข",
      "subtext": "รายการที่เรียงลำดับเป็นตัวเลข",
      "aliases": [
        "ol",
        "li",
        "list",
        "numberedlist",
        "numbered list",
        "รายการ",
        "รายการลำดับเลข",
        "ตัวเลข"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "bullet_list": {
      "title": "รายการหัวข้อย่อย",
      "subtext": "รายการแบบจุดหัวข้อย่อย",
      "aliases": [
        "ul",
        "li",
        "list",
        "bulletlist",
        "bullet list",
        "รายการ",
        "รายการหัวข้อย่อย"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "check_list": {
      "title": "รายการเช็กลิสต์",
      "subtext": "รายการพร้อมช่องทำเครื่องหมาย",
      "aliases": [
        "ul",
        "li",
        "list",
        "checklist",
        "check list",
        "checked list",
        "checkbox",
        "รายการ",
        "เช็กลิสต์",
        "สิ่งที่ต้องทำ"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "paragraph": {
      "title": "ย่อหน้า",
      "subtext": "เนื้อหาหลักของเอกสาร",
      "aliases": [
        "p",
        "paragraph",
        "ย่อหน้า",
        "ข้อความ"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "code_block": {
      "title": "บล็อกโค้ด",
      "subtext": "บล็อกโค้ดพร้อมการเน้นสีไวยากรณ์",
      "aliases": [
        "code",
        "pre",
        "โค้ด",
        "บล็อกโค้ด"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "page_break": {
      "title": "ตัวแบ่งหน้า",
      "subtext": "เส้นแบ่งหน้าเอกสาร",
      "aliases": [
        "page",
        "break",
        "separator",
        "แบ่งหน้า",
        "ตัวแบ่งหน้า"
      ],
      "group": "บล็อกพื้นฐาน"
    },
    "table": {
      "title": "ตาราง",
      "subtext": "ตารางที่แก้ไขข้อมูลในช่องได้",
      "aliases": [
        "table",
        "ตาราง"
      ],
      "group": "ขั้นสูง"
    },
    "image": {
      "title": "รูปภาพ",
      "subtext": "รูปภาพที่ปรับขนาดได้พร้อมคำบรรยาย",
      "aliases": [
        "image",
        "imageUpload",
        "upload",
        "img",
        "picture",
        "media",
        "url",
        "รูปภาพ",
        "ภาพ",
        "อัปโหลด"
      ],
      "group": "สื่อ"
    },
    "video": {
      "title": "วิดีโอ",
      "subtext": "วิดีโอที่ปรับขนาดได้พร้อมคำบรรยาย",
      "aliases": [
        "video",
        "videoUpload",
        "upload",
        "mp4",
        "film",
        "media",
        "url",
        "วิดีโอ",
        "อัปโหลด"
      ],
      "group": "สื่อ"
    },
    "audio": {
      "title": "เสียง",
      "subtext": "ไฟล์เสียงฝังในหน้าพร้อมคำบรรยาย",
      "aliases": [
        "audio",
        "audioUpload",
        "upload",
        "mp3",
        "sound",
        "media",
        "url",
        "เสียง",
        "อัปโหลด"
      ],
      "group": "สื่อ"
    },
    "file": {
      "title": "ไฟล์",
      "subtext": "ไฟล์ที่แนบฝังไว้ในหน้า",
      "aliases": [
        "file",
        "upload",
        "embed",
        "media",
        "url",
        "ไฟล์",
        "อัปโหลด"
      ],
      "group": "สื่อ"
    },
    "emoji": {
      "title": "อิโมจิ",
      "subtext": "ค้นหาและแทรกอิโมจิ",
      "aliases": [
        "emoji",
        "emote",
        "emotion",
        "face",
        "อิโมจิ"
      ],
      "group": "อื่นๆ"
    },
    "divider": {
      "title": "เส้นคั่น",
      "subtext": "เส้นแบ่งคั่นระหว่างบล็อก",
      "aliases": [
        "divider",
        "hr",
        "line",
        "horizontal rule",
        "เส้นคั่น",
        "เส้นแบ่ง"
      ],
      "group": "บล็อกพื้นฐาน"
    }
  },
  "placeholders": {
    "default": "พิมพ์ข้อความ หรือพิมพ์ '/' เพื่อใช้คำสั่ง",
    "heading": "หัวข้อ",
    "toggleListItem": "รายการยุบได้",
    "bulletListItem": "รายการ",
    "numberedListItem": "รายการ",
    "checkListItem": "รายการ",
    "new_comment": "เขียนความคิดเห็น...",
    "edit_comment": "แก้ไขความคิดเห็น...",
    "comment_reply": "เพิ่มความคิดเห็น..."
  },
  "file_blocks": {
    "add_button_text": {
      "image": "เพิ่มรูปภาพ",
      "video": "เพิ่มวิดีโอ",
      "audio": "เพิ่มเสียง",
      "file": "เพิ่มไฟล์"
    }
  },
  "toggle_blocks": {
    "add_block_button": "รายการยุบได้ยังว่างอยู่ คลิกเพื่อเพิ่มบล็อก"
  },
  "code_block": {
    "add_source_button_text": "เพิ่มซอร์สโค้ด",
    "ok_button_text": "ตกลง"
  },
  "side_menu": {
    "add_block_label": "เพิ่มบล็อก",
    "drag_handle_label": "เปิดเมนูบล็อก"
  },
  "drag_handle": {
    "delete_menuitem": "ลบ",
    "colors_menuitem": "สี",
    "header_row_menuitem": "แถวส่วนหัว",
    "header_column_menuitem": "คอลัมน์ส่วนหัว"
  },
  "table_handle": {
    "delete_column_menuitem": "ลบคอลัมน์",
    "delete_row_menuitem": "ลบแถว",
    "add_left_menuitem": "เพิ่มคอลัมน์ทางซ้าย",
    "add_right_menuitem": "เพิ่มคอลัมน์ทางขวา",
    "add_above_menuitem": "เพิ่มแถวด้านบน",
    "add_below_menuitem": "เพิ่มแถวด้านล่าง",
    "split_cell_menuitem": "แยกเซลล์",
    "merge_cells_menuitem": "ผสานเซลล์",
    "background_color_menuitem": "สีพื้นหลัง"
  },
  "suggestion_menu": {
    "no_items_title": "ไม่พบรายการ"
  },
  "color_picker": {
    "text_title": "ข้อความ",
    "background_title": "พื้นหลัง",
    "colors": {
      "default": "อัตโนมัติ",
      "gray": "สีเทา",
      "brown": "สีน้ำตาล",
      "red": "สีแดง",
      "orange": "สีส้ม",
      "yellow": "สีเหลือง",
      "green": "สีเขียว",
      "blue": "สีน้ำเงิน",
      "purple": "สีม่วง",
      "pink": "สีชมพู"
    }
  },
  "formatting_toolbar": {
    "bold": {
      "tooltip": "ตัวหนา",
      "secondary_tooltip": "Mod+B"
    },
    "italic": {
      "tooltip": "ตัวเอียง",
      "secondary_tooltip": "Mod+I"
    },
    "underline": {
      "tooltip": "ขีดเส้นใต้",
      "secondary_tooltip": "Mod+U"
    },
    "strike": {
      "tooltip": "ขีดฆ่า",
      "secondary_tooltip": "Mod+Shift+S"
    },
    "code": {
      "tooltip": "โค้ด",
      "secondary_tooltip": "โค้ดในบรรทัด"
    },
    "colors": {
      "tooltip": "สี"
    },
    "link": {
      "tooltip": "สร้างลิงก์",
      "secondary_tooltip": "Mod+K"
    },
    "file_caption": {
      "tooltip": "แก้ไขคำบรรยาย",
      "input_placeholder": "แก้ไขคำบรรยาย"
    },
    "file_replace": {
      "tooltip": {
        "image": "แทนที่รูปภาพ",
        "video": "แทนที่วิดีโอ",
        "audio": "แทนที่เสียง",
        "file": "แทนที่ไฟล์"
      }
    },
    "file_rename": {
      "tooltip": {
        "image": "เปลี่ยนชื่อรูปภาพ",
        "video": "เปลี่ยนชื่อวิดีโอ",
        "audio": "เปลี่ยนชื่อไฟล์เสียง",
        "file": "เปลี่ยนชื่อไฟล์"
      },
      "input_placeholder": {
        "image": "เปลี่ยนชื่อรูปภาพ",
        "video": "เปลี่ยนชื่อวิดีโอ",
        "audio": "เปลี่ยนชื่อไฟล์เสียง",
        "file": "เปลี่ยนชื่อไฟล์"
      }
    },
    "file_download": {
      "tooltip": {
        "image": "ดาวน์โหลดรูปภาพ",
        "video": "ดาวน์โหลดวิดีโอ",
        "audio": "ดาวน์โหลดเสียง",
        "file": "ดาวน์โหลดไฟล์"
      }
    },
    "file_delete": {
      "tooltip": {
        "image": "ลบรูปภาพ",
        "video": "ลบวิดีโอ",
        "audio": "ลบเสียง",
        "file": "ลบไฟล์"
      }
    },
    "file_preview_toggle": {
      "tooltip": "สลับการแสดงตัวอย่าง"
    },
    "nest": {
      "tooltip": "เยื้องบล็อกเข้า",
      "secondary_tooltip": "Tab"
    },
    "unnest": {
      "tooltip": "ลดการเยื้องบล็อก",
      "secondary_tooltip": "Shift+Tab"
    },
    "align_left": {
      "tooltip": "จัดชิดซ้าย"
    },
    "align_center": {
      "tooltip": "จัดกึ่งกลาง"
    },
    "align_right": {
      "tooltip": "จัดชิดขวา"
    },
    "align_justify": {
      "tooltip": "จัดเต็มแนวบรรทัด"
    },
    "table_cell_merge": {
      "tooltip": "ผสานเซลล์"
    },
    "comment": {
      "tooltip": "เพิ่มความคิดเห็น"
    }
  },
  "file_panel": {
    "upload": {
      "title": "อัปโหลด",
      "file_placeholder": {
        "image": "อัปโหลดรูปภาพ",
        "video": "อัปโหลดวิดีโอ",
        "audio": "อัปโหลดเสียง",
        "file": "อัปโหลดไฟล์"
      },
      "upload_error": "ข้อผิดพลาด: อัปโหลดไม่สำเร็จ"
    },
    "embed": {
      "title": "ฝังลิงก์",
      "embed_button": {
        "image": "ฝังรูปภาพ",
        "video": "ฝังวิดีโอ",
        "audio": "ฝังเสียง",
        "file": "ฝังไฟล์"
      },
      "url_placeholder": "ป้อน URL"
    }
  },
  "link_toolbar": {
    "delete": {
      "tooltip": "ลบลิงก์"
    },
    "edit": {
      "text": "แก้ไขลิงก์",
      "tooltip": "แก้ไข"
    },
    "open": {
      "tooltip": "เปิดในแท็บใหม่"
    },
    "form": {
      "title_placeholder": "แก้ไขชื่อเรื่อง",
      "url_placeholder": "แก้ไข URL"
    }
  },
  "comments": {
    "edited": "แก้ไขแล้ว",
    "save_button_text": "บันทึก",
    "cancel_button_text": "ยกเลิก",
    "deleted_reference_text": "เนื้อหาต้นฉบับถูกลบแล้ว",
    "discard_pending_comment": "คุณแน่ใจหรือไม่ว่าต้องการละทิ้งความคิดเห็นนี้?",
    "actions": {
      "add_reaction": "เพิ่มรีแอ็กชัน",
      "resolve": "ทำเครื่องหมายว่าแก้ไขแล้ว",
      "reopen": "เปิดอีกครั้ง",
      "edit_comment": "แก้ไขความคิดเห็น",
      "delete_comment": "ลบความคิดเห็น",
      "more_actions": "การทำงานเพิ่มเติม"
    },
    "reactions": {
      "reacted_by": "แสดงความรู้สึกโดย"
    },
    "sidebar": {
      "marked_as_resolved": "ทำเครื่องหมายว่าแก้ไขแล้ว",
      "more_replies": (count: number) => `อีก ${count} การตอบกลับ`
    }
  },
  "suggestion_changes": {
    "formatting_change": "การเปลี่ยนรูปแบบ",
    "deleted": "ลบแล้ว",
    "inserted_by": (users: string) => `แทรกโดย: ${users}`,
    "deleted_by": (users: string) => `ลบโดย: ${users}`,
    "formatting_change_by": (formats: string, users: string) => `เปลี่ยนการจัดรูปแบบ (${formats}) โดย: ${users}`
  },
  "exporter": {
    "open_file": "เปิดไฟล์",
    "open_video_file": "เปิดวิดีโอ",
    "open_audio_file": "เปิดเสียง"
  },
  "generic": {
    "ctrl_shortcut": "Ctrl",
    "form_submit": "ตกลง"
  }
};

export const blockNoteHi: Dictionary = {
  "slash_menu": {
    "heading": {
      "title": "शीर्षक 1",
      "subtext": "सबसे बड़े स्तर का मुख्य शीर्षक",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "शीर्षक",
        "शीर्षक 1",
        "हेडिंग"
      ],
      "group": "शीर्षक"
    },
    "heading_2": {
      "title": "शीर्षक 2",
      "subtext": "प्रमुख अनुभाग का शीर्षक",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "शीर्षक",
        "शीर्षक 2",
        "उपशीर्षक"
      ],
      "group": "शीर्षक"
    },
    "heading_3": {
      "title": "शीर्षक 3",
      "subtext": "उप-अनुभाग और समूह का शीर्षक",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "शीर्षक",
        "शीर्षक 3",
        "उपशीर्षक"
      ],
      "group": "शीर्षक"
    },
    "heading_4": {
      "title": "शीर्षक 4",
      "subtext": "छोटे उप-अनुभाग का शीर्षक",
      "aliases": [
        "h4",
        "heading4",
        "subheading4",
        "शीर्षक 4"
      ],
      "group": "उपशीर्षक"
    },
    "heading_5": {
      "title": "शीर्षक 5",
      "subtext": "लघु उप-अनुभाग का शीर्षक",
      "aliases": [
        "h5",
        "heading5",
        "subheading5",
        "शीर्षक 5"
      ],
      "group": "उपशीर्षक"
    },
    "heading_6": {
      "title": "शीर्षक 6",
      "subtext": "सबसे छोटे स्तर का शीर्षक",
      "aliases": [
        "h6",
        "heading6",
        "subheading6",
        "शीर्षक 6"
      ],
      "group": "उपशीर्षक"
    },
    "toggle_heading": {
      "title": "टॉगल शीर्षक 1",
      "subtext": "खुलने और सिमटने वाला मुख्य शीर्षक",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "collapsable",
        "शीर्षक",
        "टॉगल",
        "टॉगल शीर्षक"
      ],
      "group": "उपशीर्षक"
    },
    "toggle_heading_2": {
      "title": "टॉगल शीर्षक 2",
      "subtext": "खुलने और सिमटने वाला अनुभाग शीर्षक",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "collapsable",
        "शीर्षक 2",
        "टॉगल",
        "टॉगल शीर्षक"
      ],
      "group": "उपशीर्षक"
    },
    "toggle_heading_3": {
      "title": "टॉगल शीर्षक 3",
      "subtext": "खुलने और सिमटने वाला उप-अनुभाग शीर्षक",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "collapsable",
        "शीर्षक 3",
        "टॉगल",
        "टॉगल शीर्षक"
      ],
      "group": "उपशीर्षक"
    },
    "quote": {
      "title": "उद्धरण",
      "subtext": "उद्धरण या अंश",
      "aliases": [
        "quotation",
        "blockquote",
        "bq",
        "उद्धरण",
        "कोट"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "toggle_list": {
      "title": "टॉगल सूची",
      "subtext": "छुपाए जा सकने वाले उप-बिंदुओं वाली सूची",
      "aliases": [
        "li",
        "list",
        "toggleList",
        "toggle list",
        "collapsable list",
        "सूची",
        "टॉगल सूची",
        "टॉगल"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "numbered_list": {
      "title": "क्रमांकित सूची",
      "subtext": "क्रमबद्ध संख्याओं वाली सूची",
      "aliases": [
        "ol",
        "li",
        "list",
        "numberedlist",
        "numbered list",
        "सूची",
        "क्रमांकित सूची",
        "नंबर सूची"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "bullet_list": {
      "title": "बुलेट सूची",
      "subtext": "बुलेट बिंदुओं वाली सूची",
      "aliases": [
        "ul",
        "li",
        "list",
        "bulletlist",
        "bullet list",
        "सूची",
        "बुलेट सूची"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "check_list": {
      "title": "जाँच सूची",
      "subtext": "चेकबॉक्स वाली कार्य सूची",
      "aliases": [
        "ul",
        "li",
        "list",
        "checklist",
        "check list",
        "checked list",
        "checkbox",
        "सूची",
        "जाँच सूची",
        "कार्य सूची",
        "चेकलिस्ट"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "paragraph": {
      "title": "पैराग्राफ़",
      "subtext": "दस्तावेज़ का मुख्य टेक्स्ट",
      "aliases": [
        "p",
        "paragraph",
        "पैराग्राफ़",
        "टेक्स्ट"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "code_block": {
      "title": "कोड ब्लॉक",
      "subtext": "सिंटैक्स हाइलाइटिंग वाला कोड ब्लॉक",
      "aliases": [
        "code",
        "pre",
        "कोड",
        "कोड ब्लॉक"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "page_break": {
      "title": "पेज ब्रेक",
      "subtext": "पेज विभाजक",
      "aliases": [
        "page",
        "break",
        "separator",
        "पेज ब्रेक",
        "विभाजक"
      ],
      "group": "बेसिक ब्लॉक"
    },
    "table": {
      "title": "तालिका",
      "subtext": "संपादन योग्य कक्षों वाली तालिका",
      "aliases": [
        "table",
        "तालिका",
        "टेबल"
      ],
      "group": "उन्नत"
    },
    "image": {
      "title": "इमेज",
      "subtext": "कैप्शन के साथ आकार बदलने योग्य इमेज",
      "aliases": [
        "image",
        "imageUpload",
        "upload",
        "img",
        "picture",
        "media",
        "url",
        "इमेज",
        "तस्वीर",
        "फ़ोटो",
        "अपलोड"
      ],
      "group": "मीडिया"
    },
    "video": {
      "title": "वीडियो",
      "subtext": "कैप्शन के साथ आकार बदलने योग्य वीडियो",
      "aliases": [
        "video",
        "videoUpload",
        "upload",
        "mp4",
        "film",
        "media",
        "url",
        "वीडियो",
        "अपलोड"
      ],
      "group": "मीडिया"
    },
    "audio": {
      "title": "ऑडियो",
      "subtext": "कैप्शन के साथ एम्बेड किया गया ऑडियो",
      "aliases": [
        "audio",
        "audioUpload",
        "upload",
        "mp3",
        "sound",
        "media",
        "url",
        "ऑडियो",
        "ध्वनि",
        "अपलोड"
      ],
      "group": "मीडिया"
    },
    "file": {
      "title": "फ़ाइल",
      "subtext": "एम्बेड की गई फ़ाइल",
      "aliases": [
        "file",
        "upload",
        "embed",
        "media",
        "url",
        "फ़ाइल",
        "अपलोड"
      ],
      "group": "मीडिया"
    },
    "emoji": {
      "title": "इमोजी",
      "subtext": "इमोजी खोजें और जोड़ें",
      "aliases": [
        "emoji",
        "emote",
        "emotion",
        "face",
        "इमोजी"
      ],
      "group": "अन्य"
    },
    "divider": {
      "title": "विभाजक रेखा",
      "subtext": "ब्लॉकों को अलग करने वाली रेखा",
      "aliases": [
        "divider",
        "hr",
        "line",
        "horizontal rule",
        "विभाजक",
        "रेखा"
      ],
      "group": "बेसिक ब्लॉक"
    }
  },
  "placeholders": {
    "default": "टेक्स्ट लिखें या कमांड के लिए '/' टाइप करें",
    "heading": "शीर्षक",
    "toggleListItem": "टॉगल",
    "bulletListItem": "सूची",
    "numberedListItem": "सूची",
    "checkListItem": "सूची",
    "new_comment": "टिप्पणी लिखें...",
    "edit_comment": "टिप्पणी संपादित करें...",
    "comment_reply": "टिप्पणी जोड़ें..."
  },
  "file_blocks": {
    "add_button_text": {
      "image": "इमेज जोड़ें",
      "video": "वीडियो जोड़ें",
      "audio": "ऑडियो जोड़ें",
      "file": "फ़ाइल जोड़ें"
    }
  },
  "toggle_blocks": {
    "add_block_button": "खाली टॉगल। ब्लॉक जोड़ने के लिए क्लिक करें।"
  },
  "code_block": {
    "add_source_button_text": "सोर्स कोड जोड़ें",
    "ok_button_text": "ठीक है"
  },
  "side_menu": {
    "add_block_label": "ब्लॉक जोड़ें",
    "drag_handle_label": "ब्लॉक मेनू खोलें"
  },
  "drag_handle": {
    "delete_menuitem": "हटाएँ",
    "colors_menuitem": "रंग",
    "header_row_menuitem": "हेडर पंक्ति",
    "header_column_menuitem": "हेडर कॉलम"
  },
  "table_handle": {
    "delete_column_menuitem": "कॉलम हटाएँ",
    "delete_row_menuitem": "पंक्ति हटाएँ",
    "add_left_menuitem": "बाएँ कॉलम जोड़ें",
    "add_right_menuitem": "दाएँ कॉलम जोड़ें",
    "add_above_menuitem": "ऊपर पंक्ति जोड़ें",
    "add_below_menuitem": "नीचे पंक्ति जोड़ें",
    "split_cell_menuitem": "कक्ष विभाजित करें",
    "merge_cells_menuitem": "कक्ष मिलाएँ",
    "background_color_menuitem": "बैकग्राउंड रंग"
  },
  "suggestion_menu": {
    "no_items_title": "कोई आइटम नहीं मिला"
  },
  "color_picker": {
    "text_title": "टेक्स्ट",
    "background_title": "बैकग्राउंड",
    "colors": {
      "default": "ऑटो",
      "gray": "स्लेटी",
      "brown": "भूरा",
      "red": "लाल",
      "orange": "नारंगी",
      "yellow": "पीला",
      "green": "हरा",
      "blue": "नीला",
      "purple": "बैंगनी",
      "pink": "गुलाबी"
    }
  },
  "formatting_toolbar": {
    "bold": {
      "tooltip": "बोल्ड",
      "secondary_tooltip": "Mod+B"
    },
    "italic": {
      "tooltip": "इटैलिक",
      "secondary_tooltip": "Mod+I"
    },
    "underline": {
      "tooltip": "अंडरलाइन",
      "secondary_tooltip": "Mod+U"
    },
    "strike": {
      "tooltip": "स्ट्राइकथ्रू",
      "secondary_tooltip": "Mod+Shift+S"
    },
    "code": {
      "tooltip": "कोड",
      "secondary_tooltip": "इनलाइन कोड"
    },
    "colors": {
      "tooltip": "रंग"
    },
    "link": {
      "tooltip": "लिंक बनाएँ",
      "secondary_tooltip": "Mod+K"
    },
    "file_caption": {
      "tooltip": "कैप्शन संपादित करें",
      "input_placeholder": "कैप्शन संपादित करें"
    },
    "file_replace": {
      "tooltip": {
        "image": "इमेज बदलें",
        "video": "वीडियो बदलें",
        "audio": "ऑडियो बदलें",
        "file": "फ़ाइल बदलें"
      }
    },
    "file_rename": {
      "tooltip": {
        "image": "इमेज का नाम बदलें",
        "video": "वीडियो का नाम बदलें",
        "audio": "ऑडियो का नाम बदलें",
        "file": "फ़ाइल का नाम बदलें"
      },
      "input_placeholder": {
        "image": "इमेज का नाम बदलें",
        "video": "वीडियो का नाम बदलें",
        "audio": "ऑडियो का नाम बदलें",
        "file": "फ़ाइल का नाम बदलें"
      }
    },
    "file_download": {
      "tooltip": {
        "image": "इमेज डाउनलोड करें",
        "video": "वीडियो डाउनलोड करें",
        "audio": "ऑडियो डाउनलोड करें",
        "file": "फ़ाइल डाउनलोड करें"
      }
    },
    "file_delete": {
      "tooltip": {
        "image": "इमेज हटाएँ",
        "video": "वीडियो हटाएँ",
        "audio": "ऑडियो हटाएँ",
        "file": "फ़ाइल हटाएँ"
      }
    },
    "file_preview_toggle": {
      "tooltip": "पूर्वावलोकन चालू/बंद करें"
    },
    "nest": {
      "tooltip": "इंडेंट बढ़ाएँ",
      "secondary_tooltip": "Tab"
    },
    "unnest": {
      "tooltip": "इंडेंट घटाएँ",
      "secondary_tooltip": "Shift+Tab"
    },
    "align_left": {
      "tooltip": "बाएँ संरेखित करें"
    },
    "align_center": {
      "tooltip": "बीच में संरेखित करें"
    },
    "align_right": {
      "tooltip": "दाएँ संरेखित करें"
    },
    "align_justify": {
      "tooltip": "दोनों ओर संरेखित करें"
    },
    "table_cell_merge": {
      "tooltip": "कक्ष मिलाएँ"
    },
    "comment": {
      "tooltip": "टिप्पणी जोड़ें"
    }
  },
  "file_panel": {
    "upload": {
      "title": "अपलोड करें",
      "file_placeholder": {
        "image": "इमेज अपलोड करें",
        "video": "वीडियो अपलोड करें",
        "audio": "ऑडियो अपलोड करें",
        "file": "फ़ाइल अपलोड करें"
      },
      "upload_error": "त्रुटि: अपलोड विफल रहा"
    },
    "embed": {
      "title": "एम्बेड करें",
      "embed_button": {
        "image": "इमेज एम्बेड करें",
        "video": "वीडियो एम्बेड करें",
        "audio": "ऑडियो एम्बेड करें",
        "file": "फ़ाइल एम्बेड करें"
      },
      "url_placeholder": "URL दर्ज करें"
    }
  },
  "link_toolbar": {
    "delete": {
      "tooltip": "लिंक हटाएँ"
    },
    "edit": {
      "text": "लिंक संपादित करें",
      "tooltip": "संपादित करें"
    },
    "open": {
      "tooltip": "नए टैब में खोलें"
    },
    "form": {
      "title_placeholder": "शीर्षक संपादित करें",
      "url_placeholder": "URL संपादित करें"
    }
  },
  "comments": {
    "edited": "संपादित",
    "save_button_text": "सेव करें",
    "cancel_button_text": "रद्द करें",
    "deleted_reference_text": "मूल सामग्री हटा दी गई",
    "discard_pending_comment": "क्या आप वाकई इस टिप्पणी को छोड़ना चाहते हैं?",
    "actions": {
      "add_reaction": "प्रतिक्रिया जोड़ें",
      "resolve": "सुलझाएँ",
      "reopen": "फिर से खोलें",
      "edit_comment": "टिप्पणी संपादित करें",
      "delete_comment": "टिप्पणी हटाएँ",
      "more_actions": "अन्य कार्रवाइयाँ"
    },
    "reactions": {
      "reacted_by": "प्रतिक्रिया दी"
    },
    "sidebar": {
      "marked_as_resolved": "सुलझा हुआ चिह्नित किया गया",
      "more_replies": (count: number) => `${count} और जवाब`
    }
  },
  "suggestion_changes": {
    "formatting_change": "फ़ॉर्मेटिंग बदलाव",
    "deleted": "हटाया गया",
    "inserted_by": (users: string) => `द्वारा जोड़ा गया: ${users}`,
    "deleted_by": (users: string) => `द्वारा हटाया गया: ${users}`,
    "formatting_change_by": (formats: string, users: string) => `फ़ॉर्मेटिंग बदलाव (${formats}) द्वारा: ${users}`
  },
  "exporter": {
    "open_file": "फ़ाइल खोलें",
    "open_video_file": "वीडियो खोलें",
    "open_audio_file": "ऑडियो खोलें"
  },
  "generic": {
    "ctrl_shortcut": "Ctrl",
    "form_submit": "ठीक है"
  }
};

export const blockNoteTr: Dictionary = {
  "slash_menu": {
    "heading": {
      "title": "Başlık 1",
      "subtext": "En üst düzey başlık",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "başlık",
        "baslik",
        "başlık 1",
        "baslik 1"
      ],
      "group": "Başlıklar"
    },
    "heading_2": {
      "title": "Başlık 2",
      "subtext": "Ana bölüm başlığı",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "başlık",
        "baslik",
        "başlık 2",
        "alt başlık"
      ],
      "group": "Başlıklar"
    },
    "heading_3": {
      "title": "Başlık 3",
      "subtext": "Alt bölüm ve grup başlığı",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "başlık",
        "baslik",
        "başlık 3",
        "alt başlık"
      ],
      "group": "Başlıklar"
    },
    "heading_4": {
      "title": "Başlık 4",
      "subtext": "Küçük alt bölüm başlığı",
      "aliases": [
        "h4",
        "heading4",
        "subheading4",
        "başlık 4",
        "baslik 4",
        "alt başlık 4"
      ],
      "group": "Alt başlıklar"
    },
    "heading_5": {
      "title": "Başlık 5",
      "subtext": "Daha küçük alt bölüm başlığı",
      "aliases": [
        "h5",
        "heading5",
        "subheading5",
        "başlık 5",
        "baslik 5",
        "alt başlık 5"
      ],
      "group": "Alt başlıklar"
    },
    "heading_6": {
      "title": "Başlık 6",
      "subtext": "En alt düzey başlık",
      "aliases": [
        "h6",
        "heading6",
        "subheading6",
        "başlık 6",
        "baslik 6",
        "alt başlık 6"
      ],
      "group": "Alt başlıklar"
    },
    "toggle_heading": {
      "title": "Açılır Başlık 1",
      "subtext": "Açılıp kapanabilir en üst düzey başlık",
      "aliases": [
        "h",
        "heading1",
        "h1",
        "collapsable",
        "başlık 1",
        "açılır",
        "acilir",
        "daraltılabilir"
      ],
      "group": "Alt başlıklar"
    },
    "toggle_heading_2": {
      "title": "Açılır Başlık 2",
      "subtext": "Açılıp kapanabilir ana bölüm başlığı",
      "aliases": [
        "h2",
        "heading2",
        "subheading",
        "collapsable",
        "başlık 2",
        "açılır",
        "acilir",
        "daraltılabilir"
      ],
      "group": "Alt başlıklar"
    },
    "toggle_heading_3": {
      "title": "Açılır Başlık 3",
      "subtext": "Açılıp kapanabilir alt bölüm ve grup başlığı",
      "aliases": [
        "h3",
        "heading3",
        "subheading",
        "collapsable",
        "başlık 3",
        "açılır",
        "acilir",
        "daraltılabilir"
      ],
      "group": "Alt başlıklar"
    },
    "quote": {
      "title": "Alıntı",
      "subtext": "Alıntı veya pasaj",
      "aliases": [
        "quotation",
        "blockquote",
        "bq",
        "alıntı",
        "alinti"
      ],
      "group": "Temel bloklar"
    },
    "toggle_list": {
      "title": "Açılır Liste",
      "subtext": "Gizlenebilir alt öğelere sahip liste",
      "aliases": [
        "li",
        "list",
        "toggleList",
        "toggle list",
        "collapsable list",
        "liste",
        "açılır liste",
        "acilir liste"
      ],
      "group": "Temel bloklar"
    },
    "numbered_list": {
      "title": "Numaralı Liste",
      "subtext": "Sıralı öğelere sahip liste",
      "aliases": [
        "ol",
        "li",
        "list",
        "numberedlist",
        "numbered list",
        "liste",
        "numaralı liste",
        "numarali liste"
      ],
      "group": "Temel bloklar"
    },
    "bullet_list": {
      "title": "Madde İşaretli Liste",
      "subtext": "Sırasız öğelere sahip liste",
      "aliases": [
        "ul",
        "li",
        "list",
        "bulletlist",
        "bullet list",
        "liste",
        "madde işaretli liste",
        "madde"
      ],
      "group": "Temel bloklar"
    },
    "check_list": {
      "title": "Yapılacaklar Listesi",
      "subtext": "Onay kutulu liste",
      "aliases": [
        "ul",
        "li",
        "list",
        "checklist",
        "check list",
        "checked list",
        "checkbox",
        "yapılacaklar",
        "kontrol listesi",
        "görev"
      ],
      "group": "Temel bloklar"
    },
    "paragraph": {
      "title": "Paragraf",
      "subtext": "Belgenizin gövde metni",
      "aliases": [
        "p",
        "paragraph",
        "paragraf",
        "metin"
      ],
      "group": "Temel bloklar"
    },
    "code_block": {
      "title": "Kod Bloğu",
      "subtext": "Sözdizimi vurgulamalı kod bloğu",
      "aliases": [
        "code",
        "pre",
        "kod",
        "kod bloğu",
        "kod blogu"
      ],
      "group": "Temel bloklar"
    },
    "page_break": {
      "title": "Sayfa Sonu",
      "subtext": "Sayfa ayırıcı",
      "aliases": [
        "page",
        "break",
        "separator",
        "sayfa",
        "sayfa sonu",
        "ayırıcı"
      ],
      "group": "Temel bloklar"
    },
    "table": {
      "title": "Tablo",
      "subtext": "Düzenlenebilir hücreli tablo",
      "aliases": [
        "table",
        "tablo"
      ],
      "group": "Gelişmiş"
    },
    "image": {
      "title": "Görsel",
      "subtext": "Altyazılı, yeniden boyutlandırılabilir görsel",
      "aliases": [
        "image",
        "imageUpload",
        "upload",
        "img",
        "picture",
        "media",
        "url",
        "görsel",
        "gorsel",
        "resim",
        "yükle"
      ],
      "group": "Medya"
    },
    "video": {
      "title": "Video",
      "subtext": "Altyazılı, yeniden boyutlandırılabilir video",
      "aliases": [
        "video",
        "videoUpload",
        "upload",
        "mp4",
        "film",
        "media",
        "url",
        "yükle"
      ],
      "group": "Medya"
    },
    "audio": {
      "title": "Ses",
      "subtext": "Altyazılı gömülü ses kaydı",
      "aliases": [
        "audio",
        "audioUpload",
        "upload",
        "mp3",
        "sound",
        "media",
        "url",
        "ses",
        "yükle"
      ],
      "group": "Medya"
    },
    "file": {
      "title": "Dosya",
      "subtext": "Gömülü dosya",
      "aliases": [
        "file",
        "upload",
        "embed",
        "media",
        "url",
        "dosya",
        "yükle",
        "göm"
      ],
      "group": "Medya"
    },
    "emoji": {
      "title": "Emoji",
      "subtext": "Emoji arayın ve ekleyin",
      "aliases": [
        "emoji",
        "emote",
        "emotion",
        "face",
        "ifade",
        "yüz"
      ],
      "group": "Diğer"
    },
    "divider": {
      "title": "Ayırıcı",
      "subtext": "Blokları görsel olarak ayırın",
      "aliases": [
        "divider",
        "hr",
        "line",
        "horizontal rule",
        "ayırıcı",
        "ayirici",
        "çizgi"
      ],
      "group": "Temel bloklar"
    }
  },
  "placeholders": {
    "default": "Metin girin veya komutlar için '/' yazın",
    "heading": "Başlık",
    "toggleListItem": "Açılır liste",
    "bulletListItem": "Liste",
    "numberedListItem": "Liste",
    "checkListItem": "Liste",
    "new_comment": "Yorum yazın...",
    "edit_comment": "Yorumu düzenleyin...",
    "comment_reply": "Yorum ekleyin..."
  },
  "file_blocks": {
    "add_button_text": {
      "image": "Görsel ekle",
      "video": "Video ekle",
      "audio": "Ses ekle",
      "file": "Dosya ekle"
    }
  },
  "toggle_blocks": {
    "add_block_button": "Boş açılır alan. Blok eklemek için tıklayın."
  },
  "code_block": {
    "add_source_button_text": "Kaynak kodu ekle",
    "ok_button_text": "Tamam"
  },
  "side_menu": {
    "add_block_label": "Blok ekle",
    "drag_handle_label": "Blok menüsünü aç"
  },
  "drag_handle": {
    "delete_menuitem": "Sil",
    "colors_menuitem": "Renkler",
    "header_row_menuitem": "Başlık satırı",
    "header_column_menuitem": "Başlık sütunu"
  },
  "table_handle": {
    "delete_column_menuitem": "Sütunu sil",
    "delete_row_menuitem": "Satırı sil",
    "add_left_menuitem": "Sola sütun ekle",
    "add_right_menuitem": "Sağa sütun ekle",
    "add_above_menuitem": "Üste satır ekle",
    "add_below_menuitem": "Alta satır ekle",
    "split_cell_menuitem": "Hücreyi böl",
    "merge_cells_menuitem": "Hücreleri birleştir",
    "background_color_menuitem": "Arka plan rengi"
  },
  "suggestion_menu": {
    "no_items_title": "Öğe bulunamadı"
  },
  "color_picker": {
    "text_title": "Metin",
    "background_title": "Arka plan",
    "colors": {
      "default": "Otomatik",
      "gray": "Gri",
      "brown": "Kahverengi",
      "red": "Kırmızı",
      "orange": "Turuncu",
      "yellow": "Sarı",
      "green": "Yeşil",
      "blue": "Mavi",
      "purple": "Mor",
      "pink": "Pembe"
    }
  },
  "formatting_toolbar": {
    "bold": {
      "tooltip": "Kalın",
      "secondary_tooltip": "Mod+B"
    },
    "italic": {
      "tooltip": "İtalik",
      "secondary_tooltip": "Mod+I"
    },
    "underline": {
      "tooltip": "Altı çizili",
      "secondary_tooltip": "Mod+U"
    },
    "strike": {
      "tooltip": "Üstü çizili",
      "secondary_tooltip": "Mod+Shift+S"
    },
    "code": {
      "tooltip": "Kod",
      "secondary_tooltip": "Satır içi kod"
    },
    "colors": {
      "tooltip": "Renkler"
    },
    "link": {
      "tooltip": "Bağlantı oluştur",
      "secondary_tooltip": "Mod+K"
    },
    "file_caption": {
      "tooltip": "Altyazıyı düzenle",
      "input_placeholder": "Altyazıyı düzenle"
    },
    "file_replace": {
      "tooltip": {
        "image": "Görseli değiştir",
        "video": "Videoyu değiştir",
        "audio": "Sesi değiştir",
        "file": "Dosyayı değiştir"
      }
    },
    "file_rename": {
      "tooltip": {
        "image": "Görseli yeniden adlandır",
        "video": "Videoyu yeniden adlandır",
        "audio": "Sesi yeniden adlandır",
        "file": "Dosyayı yeniden adlandır"
      },
      "input_placeholder": {
        "image": "Görseli yeniden adlandır",
        "video": "Videoyu yeniden adlandır",
        "audio": "Sesi yeniden adlandır",
        "file": "Dosyayı yeniden adlandır"
      }
    },
    "file_download": {
      "tooltip": {
        "image": "Görseli indir",
        "video": "Videoyu indir",
        "audio": "Sesi indir",
        "file": "Dosyayı indir"
      }
    },
    "file_delete": {
      "tooltip": {
        "image": "Görseli sil",
        "video": "Videoyu sil",
        "audio": "Sesi sil",
        "file": "Dosyayı sil"
      }
    },
    "file_preview_toggle": {
      "tooltip": "Önizlemeyi aç/kapat"
    },
    "nest": {
      "tooltip": "Bloğu girintile",
      "secondary_tooltip": "Tab"
    },
    "unnest": {
      "tooltip": "Blok girintisini azalt",
      "secondary_tooltip": "Shift+Tab"
    },
    "align_left": {
      "tooltip": "Metni sola hizala"
    },
    "align_center": {
      "tooltip": "Metni ortala"
    },
    "align_right": {
      "tooltip": "Metni sağa hizala"
    },
    "align_justify": {
      "tooltip": "İki yana yasla"
    },
    "table_cell_merge": {
      "tooltip": "Hücreleri birleştir"
    },
    "comment": {
      "tooltip": "Yorum ekle"
    }
  },
  "file_panel": {
    "upload": {
      "title": "Yükle",
      "file_placeholder": {
        "image": "Görsel yükle",
        "video": "Video yükle",
        "audio": "Ses yükle",
        "file": "Dosya yükle"
      },
      "upload_error": "Hata: Yükleme başarısız oldu"
    },
    "embed": {
      "title": "Göm",
      "embed_button": {
        "image": "Görsel göm",
        "video": "Video göm",
        "audio": "Ses göm",
        "file": "Dosya göm"
      },
      "url_placeholder": "URL girin"
    }
  },
  "link_toolbar": {
    "delete": {
      "tooltip": "Bağlantıyı kaldır"
    },
    "edit": {
      "text": "Bağlantıyı düzenle",
      "tooltip": "Düzenle"
    },
    "open": {
      "tooltip": "Yeni sekmede aç"
    },
    "form": {
      "title_placeholder": "Başlığı düzenle",
      "url_placeholder": "URL'yi düzenle"
    }
  },
  "comments": {
    "edited": "düzenlendi",
    "save_button_text": "Kaydet",
    "cancel_button_text": "İptal",
    "deleted_reference_text": "Orijinal içerik silindi",
    "discard_pending_comment": "Bu yorumu yoksaymak istediğinizden emin misiniz?",
    "actions": {
      "add_reaction": "Tepki ekle",
      "resolve": "Çözüldü işaretle",
      "reopen": "Yeniden aç",
      "edit_comment": "Yorumu düzenle",
      "delete_comment": "Yorumu sil",
      "more_actions": "Diğer işlemler"
    },
    "reactions": {
      "reacted_by": "Tepki veren:"
    },
    "sidebar": {
      "marked_as_resolved": "Çözüldü olarak işaretlendi",
      "more_replies": (count: number) => `${count} yanıt daha`
    }
  },
  "suggestion_changes": {
    "formatting_change": "Biçimlendirme Değişikliği",
    "deleted": "Silindi",
    "inserted_by": (users: string) => `Ekleyen: ${users}`,
    "deleted_by": (users: string) => `Silen: ${users}`,
    "formatting_change_by": (formats: string, users: string) => `Biçimlendirme değişikliği (${formats}), yapan: ${users}`
  },
  "exporter": {
    "open_file": "Dosyayı aç",
    "open_video_file": "Videoyu aç",
    "open_audio_file": "Sesi aç"
  },
  "generic": {
    "ctrl_shortcut": "Ctrl",
    "form_submit": "Tamam"
  }
};
