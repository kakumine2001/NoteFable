# App Store 商店信息

App Store Connect → App → App 信息 / iOS App 的版本页。iOS 版目前只发 TestFlight；这里是 App Store 产品页要填的文字，提交审核前按这里填。语言与 App 界面相同 17 种：English (U.S.)（主要语言）、Chinese (Simplified)、Chinese (Traditional)、Japanese、Korean、Spanish (Mexico) 和 Spanish (Spain)（同一份）、French、German、Portuguese (Brazil)、Italian、Indonesian、Vietnamese、Thai、Hindi、Arabic、Turkish、Russian。字数上限：名称 30、副标题 30、推广文本 170、关键词 100（逗号分隔、不加空格）、描述 4000。

内容只写 iOS 版已经能用的功能（见 [ios-native.md](../architecture/ios-native.md)）。iOS 没有接 App Store 内购，所以描述里不写 Pro 的价格和购买（也不引导去别处购买，App 审核指南 3.1.1）；关键词不放别家的品牌名（2.3.7）。

## 各语言共用的规则

- **名称**：与 Play 的应用名相同（[docs/play-store/listing.md](../play-store/listing.md)）。
- **描述**：Play 同一语言的“完整说明”，把最后一段价格说明（NoteFable Pro 那段）换成下面各语言的“iOS 价格说明”，其余不变。
- **网址**：技术支持 https://notefable.com、营销 https://notefable.com、隐私政策 https://notefable.com/privacy。
- **类别**：主要 教育（Education），次要 效率（Productivity）。
- 截图：6.9 英寸 iPhone（1320 × 2868）。还没有正式的 App Store 截图；PR 检查的模拟器截图（`mobile/ios/scripts/ci-screenshots.sh`）只用于核对界面，不直接上传。

## English (U.S.)

- **Subtitle**: Notes, slides & whiteboards
- **Promotional text**: Ask AI anything, then keep the answer as a note, present it as slides or let the AI draw it as a diagram on a whiteboard.
- **Keywords**: study,notebook,presentation,deck,diagram,mind map,assistant,learning,pdf,markdown,school,homework
- **iOS 价格说明**: Free to use, with daily and monthly limits on AI messages and images, and 500 MB of file storage when signed in. No ads.

## Chinese (Simplified)

- **副标题**：笔记、幻灯片和白板
- **推广文本**：向 AI 随便提问，把回答存成笔记，当幻灯片放映，或让 AI 在白板上画成图。
- **关键词**：学习,笔记本,演示,思维导图,图表,AI助手,知识整理,复习,作业,PDF,Markdown,学生
- **iOS 价格说明**：免费使用，AI 消息和图片有每天、每月的使用上限，登录后有 500 MB 文件存储空间。没有广告。

## Chinese (Traditional)

- **副標題**：筆記、投影片和白板
- **推廣文字**：向 AI 隨便提問，把回答存成筆記，當投影片放映，或讓 AI 在白板上畫成圖。
- **關鍵字**：學習,筆記本,簡報,心智圖,圖表,AI助理,知識整理,複習,作業,PDF,Markdown,學生
- **iOS 價格說明**：免費使用，AI 訊息和圖片有每天、每月的使用上限，登入後有 500 MB 檔案儲存空間。沒有廣告。

## Japanese

- **サブタイトル**：ノート・スライド・ホワイトボード
- **プロモーションテキスト**：AI になんでも質問して、答えをノートに残したり、スライドとして発表したり、ホワイトボードに図として描いてもらったり。
- **キーワード**：勉強,学習,ノートアプリ,プレゼン,マインドマップ,図解,AIアシスタント,メモ,復習,PDF,Markdown,学生
- **iOS の料金の説明**：無料で使えます（AI メッセージと画像には 1 日・1 か月の上限があり、ログインするとファイルを 500 MB まで保存できます）。広告はありません。

## Korean

- **부제**: 노트, 슬라이드, 화이트보드
- **프로모션 텍스트**: AI에게 무엇이든 물어보고, 답변을 노트로 남기거나 슬라이드로 발표하거나 화이트보드에 다이어그램으로 그려 달라고 하세요.
- **키워드**: 공부,학습,노트앱,프레젠테이션,마인드맵,다이어그램,AI비서,메모,복습,PDF,마크다운,학생
- **iOS 요금 안내**: 무료로 쓸 수 있으며 AI 메시지와 이미지에는 일일·월간 한도가 있고, 로그인하면 파일 저장 공간 500 MB를 쓸 수 있어요. 광고는 없습니다.

## Spanish (Mexico) / Spanish (Spain)

- **Subtítulo**: Notas, diapositivas y pizarras
- **Texto promocional**: Pregunta lo que quieras a la IA y guarda la respuesta como nota, preséntala como diapositivas o deja que la IA la dibuje como diagrama en una pizarra.
- **Palabras clave**: estudio,cuaderno,presentación,diagrama,mapa mental,asistente,apuntes,aprender,pdf,markdown,escuela
- **Precio en iOS**: Uso gratuito con límites diarios y mensuales de mensajes e imágenes de IA, y 500 MB de almacenamiento para tus archivos al iniciar sesión. Sin anuncios.

## French

- **Sous-titre**: Notes, diapositives, tableaux
- **Texte promotionnel**: Posez vos questions à l'IA, puis gardez la réponse en note, présentez-la en diapositives ou laissez l'IA la dessiner en schéma sur un tableau blanc.
- **Mots-clés**: étude,cahier,présentation,diagramme,carte mentale,assistant,cours,apprendre,pdf,markdown,école
- **Prix sur iOS**: Gratuit, avec des limites quotidiennes et mensuelles sur les messages et images IA, et 500 MB de stockage pour vos fichiers une fois connecté. Sans publicité.

## German

- **Untertitel**: Notizen, Folien, Whiteboards
- **Werbetext**: Frag die KI, was du willst, und halte die Antwort als Notiz fest, präsentiere sie als Folien oder lass die KI sie als Diagramm aufs Whiteboard zeichnen.
- **Keywords**: lernen,notizbuch,präsentation,diagramm,mindmap,assistent,schule,studium,pdf,markdown,mitschrift
- **Preis auf iOS**: Kostenlos nutzbar mit täglichen und monatlichen Limits für KI-Nachrichten und -Bilder und 500 MB Speicherplatz für deine Dateien, wenn du angemeldet bist. Keine Werbung.

## Portuguese (Brazil)

- **Subtítulo**: Notas, slides, quadros brancos
- **Texto promocional**: Pergunte o que quiser à IA e guarde a resposta como nota, apresente-a como slides ou deixe a IA desenhá-la como diagrama em um quadro branco.
- **Palavras-chave**: estudo,caderno,apresentação,diagrama,mapa mental,assistente,aprender,anotações,pdf,markdown,escola
- **Preço no iOS**: Uso gratuito com limites diários e mensais de mensagens e imagens de IA, e 500 MB de armazenamento para seus arquivos ao entrar na conta. Sem anúncios.

## Italian

- **Sottotitolo**: Note, presentazioni e lavagne
- **Testo promozionale**: Chiedi qualsiasi cosa all'IA, poi conserva la risposta come nota, presentala come diapositive o lascia che l'IA la disegni come diagramma su una lavagna.
- **Parole chiave**: studio,quaderno,presentazione,diagramma,mappa mentale,assistente,appunti,imparare,pdf,markdown
- **Prezzo su iOS**: Gratuito con limiti giornalieri e mensili per messaggi e immagini IA, e 500 MB di spazio per i tuoi file quando accedi. Nessuna pubblicità.

## Indonesian

- **Subjudul**: Catatan, slide, papan tulis
- **Teks promosi**: Tanyakan apa saja ke AI, lalu simpan jawabannya sebagai catatan, presentasikan sebagai slide, atau biarkan AI menggambarnya sebagai diagram di papan tulis.
- **Kata kunci**: belajar,buku catatan,presentasi,diagram,peta pikiran,asisten,sekolah,kuliah,pdf,markdown,tugas
- **Harga di iOS**: Gratis digunakan dengan batas harian dan bulanan untuk pesan dan gambar AI, serta penyimpanan file 500 MB setelah masuk. Tanpa iklan.

## Vietnamese

- **Phụ đề**: Ghi chú, slide và bảng trắng
- **Văn bản quảng bá**: Hỏi AI bất cứ điều gì, rồi lưu câu trả lời thành ghi chú, trình chiếu như slide hoặc để AI vẽ thành sơ đồ trên bảng trắng.
- **Từ khóa**: học tập,sổ tay,thuyết trình,sơ đồ,sơ đồ tư duy,trợ lý,ôn tập,bài tập,pdf,markdown,sinh viên
- **Giá trên iOS**: Miễn phí với giới hạn hằng ngày và hằng tháng cho tin nhắn và hình ảnh AI, cùng 500 MB lưu trữ tệp khi đăng nhập. Không có quảng cáo.

## Thai

- **คำบรรยายย่อย**: โน้ต สไลด์ และไวท์บอร์ด
- **ข้อความโปรโมท**: ถาม AI ได้ทุกเรื่อง แล้วเก็บคำตอบเป็นโน้ต นำเสนอเป็นสไลด์ หรือให้ AI วาดเป็นแผนภาพบนไวท์บอร์ด
- **คำสำคัญ**: เรียน,สมุดโน้ต,พรีเซนต์,แผนภาพ,มายด์แมป,ผู้ช่วย,ทบทวน,การบ้าน,pdf,markdown,นักเรียน
- **ราคาบน iOS**: ใช้ฟรีโดยมีขีดจำกัดรายวันและรายเดือนสำหรับข้อความและรูปภาพ AI และมีพื้นที่เก็บไฟล์ 500 MB เมื่อลงชื่อเข้าใช้ ไม่มีโฆษณา

## Hindi

- **उपशीर्षक**: नोट्स, स्लाइड और व्हाइटबोर्ड
- **प्रचार टेक्स्ट**: AI से कुछ भी पूछें, फिर जवाब को नोट में रखें, स्लाइड की तरह प्रस्तुत करें या AI से व्हाइटबोर्ड पर डायग्राम बनवाएँ।
- **कीवर्ड**: पढ़ाई,नोटबुक,प्रेजेंटेशन,डायग्राम,माइंड मैप,सहायक,होमवर्क,परीक्षा,pdf,markdown,छात्र
- **iOS पर कीमत**: AI संदेशों और इमेज की दैनिक और मासिक सीमाओं के साथ मुफ़्त, और साइन इन करने पर फ़ाइलों के लिए 500 MB स्टोरेज। कोई विज्ञापन नहीं।

## Arabic

- **العنوان الفرعي**: ملاحظات وشرائح وسبورات
- **النص الترويجي**: اسأل الذكاء الاصطناعي عن أي شيء، ثم احفظ الإجابة كملاحظة أو اعرضها كشرائح أو دعه يرسمها كمخطط على سبورة.
- **الكلمات المفتاحية**: دراسة,دفتر,عرض تقديمي,مخطط,خريطة ذهنية,مساعد,مراجعة,واجبات,pdf,markdown,طلاب
- **السعر على iOS**: مجاني مع حدود يومية وشهرية لرسائل وصور الذكاء الاصطناعي، و500 MB لتخزين ملفاتك عند تسجيل الدخول. بلا إعلانات.

## Turkish

- **Alt başlık**: Not, slayt ve beyaz tahta
- **Tanıtım metni**: Yapay zekâya her şeyi sor; yanıtı not olarak sakla, slayt olarak sun ya da beyaz tahtada diyagram olarak çizdir.
- **Anahtar kelimeler**: ders,defter,sunum,diyagram,zihin haritası,asistan,öğrenme,ödev,pdf,markdown,öğrenci
- **iOS fiyatı**: Yapay zekâ mesajları ve görselleri için günlük ve aylık sınırlarla ücretsiz; oturum açınca dosyaların için 500 MB depolama alanı. Reklam yok.

## Russian

- **Подзаголовок**: Заметки, слайды и доски
- **Рекламный текст**: Спросите ИИ о чём угодно, а ответ сохраните как заметку, покажите как слайды или попросите ИИ нарисовать его схемой на доске.
- **Ключевые слова**: учеба,блокнот,презентация,схема,майнд-карта,ассистент,конспект,домашка,pdf,markdown,студент
- **Цена в iOS**: Бесплатно, с дневными и месячными лимитами на сообщения и изображения ИИ и 500 MB для ваших файлов после входа. Без рекламы.
