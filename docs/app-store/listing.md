# App Store 商店信息

App Store Connect → App → App 信息 / iOS App 的版本页。iOS 版目前只发 TestFlight；这里是 App Store 产品页要填的文字，提交审核前按这里填。语言与 App 界面相同 17 种：English (U.S.)（主要语言）、Chinese (Simplified)、Chinese (Traditional)、Japanese、Korean、Spanish (Mexico) 和 Spanish (Spain)（同一份）、French、German、Portuguese (Brazil)、Italian、Indonesian、Vietnamese、Thai、Hindi、Arabic、Turkish、Russian。字数上限：名称 30、副标题 30、推广文本 170、关键词 100（逗号分隔、不加空格）、描述 4000。

内容只写 iOS 版已经能用的功能（见 [ios-native.md](../architecture/ios-native.md)）。iOS 用 App Store 订阅内购（[billing.md](../architecture/billing.md)）：描述写清 Pro 提高什么、自动续订和取消方式，不写具体价格（各店面不同，以 App 内显示为准）和试用（有介绍优惠时由 App Store 显示），并附使用条款和隐私政策链接（审核指南 3.1.2）；不引导去别处购买（3.1.1）。内购要随 App 版本一起送审。关键词不放别家的品牌名（2.3.7）。

## 各语言共用的规则

- **名称**：与 Play 的应用名相同（[docs/play-store/listing.md](../play-store/listing.md)）。
- **描述**：Play 同一语言的“完整说明”，把最后一段价格说明（NoteFable Pro 那段）换成下面各语言的“iOS 价格说明”（已含使用条款链接），其余不变（隐私政策链接保留）。
- **网址**：技术支持 https://notefable.com、营销 https://notefable.com、隐私政策 https://notefable.com/privacy。
- **类别**：主要 教育（Education），次要 效率（Productivity）。
- 截图：6.9 英寸 iPhone（1320 × 2868）。还没有正式的 App Store 截图；PR 检查的模拟器截图（`mobile/ios/scripts/ci-screenshots.sh`）只用于核对界面，不直接上传。

## English (U.S.)

- **Subtitle**: Notes, slides & whiteboards
- **Promotional text**: Ask AI anything, then keep the answer as a note, present it as slides or let the AI draw it as a diagram on a whiteboard.
- **Keywords**: study,notebook,presentation,deck,diagram,mind map,assistant,learning,pdf,markdown,school,homework
- **iOS 价格说明**: Free to use, with daily and monthly limits on AI messages and images, and 500 MB of file storage when signed in. NoteFable Pro (monthly auto-renewing subscription) raises the limits to 2,000 messages and 60 images a month (up to 10 images a day) and storage to 10 GB. The price is shown in the app before you subscribe. Payment is charged to your Apple Account, and the subscription renews automatically unless you cancel at least 24 hours before the end of the period; manage or cancel it in your Apple Account settings. No ads. Terms of Use: https://notefable.com/terms

## Chinese (Simplified)

- **副标题**：笔记、幻灯片和白板
- **推广文本**：向 AI 随便提问，把回答存成笔记，当幻灯片放映，或让 AI 在白板上画成图。
- **关键词**：学习,笔记本,演示,思维导图,图表,AI助手,知识整理,复习,作业,PDF,Markdown,学生
- **iOS 价格说明**：免费使用，AI 消息和图片有每天、每月的使用上限，登录后有 500 MB 文件存储空间。订阅 NoteFable Pro（按月自动续订）后，每月可用 2,000 条消息和 60 张图片（每天最多 10 张），存储空间增至 10 GB。订阅前 App 内会显示价格；费用从你的 Apple 账户扣除，除非在当前周期结束前至少 24 小时取消，否则会自动续订，可在 Apple 账户设置中管理或取消。没有广告。使用条款：https://notefable.com/terms

## Chinese (Traditional)

- **副標題**：筆記、投影片和白板
- **推廣文字**：向 AI 隨便提問，把回答存成筆記，當投影片放映，或讓 AI 在白板上畫成圖。
- **關鍵字**：學習,筆記本,簡報,心智圖,圖表,AI助理,知識整理,複習,作業,PDF,Markdown,學生
- **iOS 價格說明**：免費使用，AI 訊息和圖片有每天、每月的使用上限，登入後有 500 MB 檔案儲存空間。訂閱 NoteFable Pro（按月自動續訂）後，每月可使用 2,000 則訊息和 60 張圖片（每天最多 10 張），儲存空間增至 10 GB。訂閱前 App 內會顯示價格；費用會從你的 Apple 帳號扣款，除非在目前週期結束前至少 24 小時取消，否則會自動續訂，可在 Apple 帳號設定中管理或取消。沒有廣告。使用條款：https://notefable.com/terms

## Japanese

- **サブタイトル**：ノート・スライド・ホワイトボード
- **プロモーションテキスト**：AI になんでも質問して、答えをノートに残したり、スライドとして発表したり、ホワイトボードに図として描いてもらったり。
- **キーワード**：勉強,学習,ノートアプリ,プレゼン,マインドマップ,図解,AIアシスタント,メモ,復習,PDF,Markdown,学生
- **iOS の料金の説明**：無料で使えます（AI メッセージと画像には 1 日・1 か月の上限があり、ログインするとファイルを 500 MB まで保存できます）。NoteFable Pro（1 か月の自動更新サブスクリプション）では、1 か月にメッセージ 2,000 件・画像 60 枚まで（1 日 10 枚まで）使え、保存容量は 10 GB になります。価格は登録前にアプリ内に表示されます。料金は Apple Account に請求され、期間終了の 24 時間前までに解約しないと自動で更新されます。管理と解約は Apple Account の設定からできます。広告はありません。利用規約：https://notefable.com/terms

## Korean

- **부제**: 노트, 슬라이드, 화이트보드
- **프로모션 텍스트**: AI에게 무엇이든 물어보고, 답변을 노트로 남기거나 슬라이드로 발표하거나 화이트보드에 다이어그램으로 그려 달라고 하세요.
- **키워드**: 공부,학습,노트앱,프레젠테이션,마인드맵,다이어그램,AI비서,메모,복습,PDF,마크다운,학생
- **iOS 요금 안내**: 무료로 쓸 수 있으며 AI 메시지와 이미지에는 일일·월간 한도가 있고, 로그인하면 파일 저장 공간 500 MB를 쓸 수 있어요. NoteFable Pro(월간 자동 갱신 구독)는 한 달 메시지 2,000개, 이미지 60개(하루 최대 10개)까지 늘려 주고 저장 공간은 10 GB가 됩니다. 구독 전에 앱에 가격이 표시됩니다. 요금은 Apple 계정으로 청구되며, 기간이 끝나기 최소 24시간 전에 해지하지 않으면 자동으로 갱신됩니다. Apple 계정 설정에서 관리하거나 해지할 수 있어요. 광고는 없습니다. 이용약관: https://notefable.com/terms

## Spanish (Mexico) / Spanish (Spain)

- **Subtítulo**: Notas, diapositivas y pizarras
- **Texto promocional**: Pregunta lo que quieras a la IA y guarda la respuesta como nota, preséntala como diapositivas o deja que la IA la dibuje como diagrama en una pizarra.
- **Palabras clave**: estudio,cuaderno,presentación,diagrama,mapa mental,asistente,apuntes,aprender,pdf,markdown,escuela
- **Precio en iOS**: Uso gratuito con límites diarios y mensuales de mensajes e imágenes de IA, y 500 MB de almacenamiento para tus archivos al iniciar sesión. NoteFable Pro (suscripción mensual de renovación automática) sube los límites a 2.000 mensajes y 60 imágenes al mes (hasta 10 imágenes al día) y el almacenamiento a 10 GB. El precio se muestra en la app antes de suscribirte. El pago se carga a tu cuenta de Apple y la suscripción se renueva automáticamente salvo que la canceles al menos 24 horas antes de que termine el periodo; puedes gestionarla o cancelarla en los ajustes de tu cuenta de Apple. Sin anuncios. Condiciones de uso: https://notefable.com/terms

## French

- **Sous-titre**: Notes, diapositives, tableaux
- **Texte promotionnel**: Posez vos questions à l'IA, puis gardez la réponse en note, présentez-la en diapositives ou laissez l'IA la dessiner en schéma sur un tableau blanc.
- **Mots-clés**: étude,cahier,présentation,diagramme,carte mentale,assistant,cours,apprendre,pdf,markdown,école
- **Prix sur iOS**: Gratuit, avec des limites quotidiennes et mensuelles sur les messages et images IA, et 500 MB de stockage pour vos fichiers une fois connecté. NoteFable Pro (abonnement mensuel à renouvellement automatique) porte les limites à 2 000 messages et 60 images par mois (jusqu'à 10 images par jour) et le stockage à 10 GB. Le prix est affiché dans l'application avant l'abonnement. Le paiement est débité sur votre compte Apple et l'abonnement se renouvelle automatiquement, sauf résiliation au moins 24 heures avant la fin de la période ; gérez-le ou résiliez-le dans les réglages de votre compte Apple. Sans publicité. Conditions d'utilisation : https://notefable.com/terms

## German

- **Untertitel**: Notizen, Folien, Whiteboards
- **Werbetext**: Frag die KI, was du willst, und halte die Antwort als Notiz fest, präsentiere sie als Folien oder lass die KI sie als Diagramm aufs Whiteboard zeichnen.
- **Keywords**: lernen,notizbuch,präsentation,diagramm,mindmap,assistent,schule,studium,pdf,markdown,mitschrift
- **Preis auf iOS**: Kostenlos nutzbar mit täglichen und monatlichen Limits für KI-Nachrichten und -Bilder und 500 MB Speicherplatz für deine Dateien, wenn du angemeldet bist. NoteFable Pro (monatliches Abo mit automatischer Verlängerung) erhöht die Limits auf 2.000 Nachrichten und 60 Bilder im Monat (bis zu 10 Bilder pro Tag) und den Speicherplatz auf 10 GB. Der Preis wird vor dem Abschluss in der App angezeigt. Die Zahlung wird deinem Apple-Account belastet, und das Abo verlängert sich automatisch, wenn du es nicht mindestens 24 Stunden vor Ende des Zeitraums kündigst; verwalten und kündigen kannst du es in den Einstellungen deines Apple-Accounts. Keine Werbung. Nutzungsbedingungen: https://notefable.com/terms

## Portuguese (Brazil)

- **Subtítulo**: Notas, slides, quadros brancos
- **Texto promocional**: Pergunte o que quiser à IA e guarde a resposta como nota, apresente-a como slides ou deixe a IA desenhá-la como diagrama em um quadro branco.
- **Palavras-chave**: estudo,caderno,apresentação,diagrama,mapa mental,assistente,aprender,anotações,pdf,markdown,escola
- **Preço no iOS**: Uso gratuito com limites diários e mensais de mensagens e imagens de IA, e 500 MB de armazenamento para seus arquivos ao entrar na conta. O NoteFable Pro (assinatura mensal com renovação automática) aumenta os limites para 2.000 mensagens e 60 imagens por mês (até 10 imagens por dia) e o armazenamento para 10 GB. O preço aparece no app antes da assinatura. A cobrança é feita na sua Conta Apple, e a assinatura é renovada automaticamente se não for cancelada pelo menos 24 horas antes do fim do período; gerencie ou cancele nos ajustes da sua Conta Apple. Sem anúncios. Termos de uso: https://notefable.com/terms

## Italian

- **Sottotitolo**: Note, presentazioni e lavagne
- **Testo promozionale**: Chiedi qualsiasi cosa all'IA, poi conserva la risposta come nota, presentala come diapositive o lascia che l'IA la disegni come diagramma su una lavagna.
- **Parole chiave**: studio,quaderno,presentazione,diagramma,mappa mentale,assistente,appunti,imparare,pdf,markdown
- **Prezzo su iOS**: Gratuito con limiti giornalieri e mensili per messaggi e immagini IA, e 500 MB di spazio per i tuoi file quando accedi. NoteFable Pro (abbonamento mensile con rinnovo automatico) porta i limiti a 2.000 messaggi e 60 immagini al mese (fino a 10 immagini al giorno) e lo spazio a 10 GB. Il prezzo è mostrato nell'app prima di abbonarti. L'addebito avviene sul tuo Account Apple e l'abbonamento si rinnova automaticamente se non lo annulli almeno 24 ore prima della fine del periodo; puoi gestirlo o annullarlo nelle impostazioni del tuo Account Apple. Nessuna pubblicità. Condizioni d'uso: https://notefable.com/terms

## Indonesian

- **Subjudul**: Catatan, slide, papan tulis
- **Teks promosi**: Tanyakan apa saja ke AI, lalu simpan jawabannya sebagai catatan, presentasikan sebagai slide, atau biarkan AI menggambarnya sebagai diagram di papan tulis.
- **Kata kunci**: belajar,buku catatan,presentasi,diagram,peta pikiran,asisten,sekolah,kuliah,pdf,markdown,tugas
- **Harga di iOS**: Gratis digunakan dengan batas harian dan bulanan untuk pesan dan gambar AI, serta penyimpanan file 500 MB setelah masuk. NoteFable Pro (langganan bulanan yang diperpanjang otomatis) menaikkan batas menjadi 2.000 pesan dan 60 gambar per bulan (hingga 10 gambar per hari) dan penyimpanan menjadi 10 GB. Harga ditampilkan di aplikasi sebelum Anda berlangganan. Pembayaran ditagihkan ke Akun Apple Anda, dan langganan diperpanjang otomatis kecuali dibatalkan paling lambat 24 jam sebelum periode berakhir; kelola atau batalkan di pengaturan Akun Apple. Tanpa iklan. Ketentuan Penggunaan: https://notefable.com/terms

## Vietnamese

- **Phụ đề**: Ghi chú, slide và bảng trắng
- **Văn bản quảng bá**: Hỏi AI bất cứ điều gì, rồi lưu câu trả lời thành ghi chú, trình chiếu như slide hoặc để AI vẽ thành sơ đồ trên bảng trắng.
- **Từ khóa**: học tập,sổ tay,thuyết trình,sơ đồ,sơ đồ tư duy,trợ lý,ôn tập,bài tập,pdf,markdown,sinh viên
- **Giá trên iOS**: Miễn phí với giới hạn hằng ngày và hằng tháng cho tin nhắn và hình ảnh AI, cùng 500 MB lưu trữ tệp khi đăng nhập. NoteFable Pro (gói đăng ký tháng tự động gia hạn) nâng giới hạn lên 2.000 tin nhắn và 60 hình ảnh mỗi tháng (tối đa 10 hình ảnh mỗi ngày) và dung lượng lưu trữ lên 10 GB. Giá được hiển thị trong ứng dụng trước khi bạn đăng ký. Phí được tính vào Tài khoản Apple của bạn và gói sẽ tự động gia hạn trừ khi bạn hủy ít nhất 24 giờ trước khi hết kỳ; quản lý hoặc hủy trong phần cài đặt Tài khoản Apple. Không có quảng cáo. Điều khoản sử dụng: https://notefable.com/terms

## Thai

- **คำบรรยายย่อย**: โน้ต สไลด์ และไวท์บอร์ด
- **ข้อความโปรโมท**: ถาม AI ได้ทุกเรื่อง แล้วเก็บคำตอบเป็นโน้ต นำเสนอเป็นสไลด์ หรือให้ AI วาดเป็นแผนภาพบนไวท์บอร์ด
- **คำสำคัญ**: เรียน,สมุดโน้ต,พรีเซนต์,แผนภาพ,มายด์แมป,ผู้ช่วย,ทบทวน,การบ้าน,pdf,markdown,นักเรียน
- **ราคาบน iOS**: ใช้ฟรีโดยมีขีดจำกัดรายวันและรายเดือนสำหรับข้อความและรูปภาพ AI และมีพื้นที่เก็บไฟล์ 500 MB เมื่อลงชื่อเข้าใช้ NoteFable Pro (สมัครสมาชิกรายเดือนแบบต่ออายุอัตโนมัติ) เพิ่มขีดจำกัดเป็น 2,000 ข้อความและ 60 รูปต่อเดือน (สูงสุด 10 รูปต่อวัน) และพื้นที่เก็บไฟล์เป็น 10 GB แอปจะแสดงราคาก่อนสมัคร ระบบเรียกเก็บเงินจากบัญชี Apple ของคุณ และต่ออายุอัตโนมัติเว้นแต่จะยกเลิกอย่างน้อย 24 ชั่วโมงก่อนสิ้นสุดรอบ จัดการหรือยกเลิกได้ในการตั้งค่าบัญชี Apple ไม่มีโฆษณา ข้อกำหนดการใช้งาน: https://notefable.com/terms

## Hindi

- **उपशीर्षक**: नोट्स, स्लाइड और व्हाइटबोर्ड
- **प्रचार टेक्स्ट**: AI से कुछ भी पूछें, फिर जवाब को नोट में रखें, स्लाइड की तरह प्रस्तुत करें या AI से व्हाइटबोर्ड पर डायग्राम बनवाएँ।
- **कीवर्ड**: पढ़ाई,नोटबुक,प्रेजेंटेशन,डायग्राम,माइंड मैप,सहायक,होमवर्क,परीक्षा,pdf,markdown,छात्र
- **iOS पर कीमत**: AI संदेशों और इमेज की दैनिक और मासिक सीमाओं के साथ मुफ़्त, और साइन इन करने पर फ़ाइलों के लिए 500 MB स्टोरेज। NoteFable Pro (अपने-आप रिन्यू होने वाली मासिक सदस्यता) सीमा को हर महीने 2,000 संदेश और 60 इमेज (रोज़ 10 इमेज तक) तक और स्टोरेज को 10 GB तक बढ़ाता है। सदस्यता लेने से पहले ऐप में कीमत दिखाई जाती है। भुगतान आपके Apple खाते से लिया जाता है, और अवधि खत्म होने से कम से कम 24 घंटे पहले रद्द न करने पर सदस्यता अपने-आप रिन्यू होती है; Apple खाते की सेटिंग में इसे मैनेज या रद्द करें। कोई विज्ञापन नहीं। उपयोग की शर्तें: https://notefable.com/terms

## Arabic

- **العنوان الفرعي**: ملاحظات وشرائح وسبورات
- **النص الترويجي**: اسأل الذكاء الاصطناعي عن أي شيء، ثم احفظ الإجابة كملاحظة أو اعرضها كشرائح أو دعه يرسمها كمخطط على سبورة.
- **الكلمات المفتاحية**: دراسة,دفتر,عرض تقديمي,مخطط,خريطة ذهنية,مساعد,مراجعة,واجبات,pdf,markdown,طلاب
- **السعر على iOS**: مجاني مع حدود يومية وشهرية لرسائل وصور الذكاء الاصطناعي، و500 MB لتخزين ملفاتك عند تسجيل الدخول. يرفع NoteFable Pro (اشتراك شهري يتجدد تلقائيًا) الحدود إلى 2,000 رسالة و60 صورة شهريًا (حتى 10 صور يوميًا) والتخزين إلى 10 GB. يظهر السعر في التطبيق قبل الاشتراك. تُحصَّل المدفوعات من حساب Apple الخاص بك، ويتجدد الاشتراك تلقائيًا ما لم تلغِه قبل 24 ساعة على الأقل من نهاية الفترة؛ يمكنك إدارته أو إلغاؤه من إعدادات حساب Apple. بلا إعلانات. شروط الاستخدام: https://notefable.com/terms

## Turkish

- **Alt başlık**: Not, slayt ve beyaz tahta
- **Tanıtım metni**: Yapay zekâya her şeyi sor; yanıtı not olarak sakla, slayt olarak sun ya da beyaz tahtada diyagram olarak çizdir.
- **Anahtar kelimeler**: ders,defter,sunum,diyagram,zihin haritası,asistan,öğrenme,ödev,pdf,markdown,öğrenci
- **iOS fiyatı**: Yapay zekâ mesajları ve görselleri için günlük ve aylık sınırlarla ücretsiz; oturum açınca dosyaların için 500 MB depolama alanı. NoteFable Pro (otomatik yenilenen aylık abonelik) sınırları ayda 2.000 mesaj ve 60 görsele (günde en fazla 10 görsel), depolamayı da 10 GB'a çıkarır. Fiyat, abone olmadan önce uygulamada gösterilir. Ödeme Apple Hesabından alınır ve dönem bitiminden en az 24 saat önce iptal edilmezse abonelik otomatik yenilenir; Apple Hesabı ayarlarından yönetebilir veya iptal edebilirsin. Reklam yok. Kullanım Koşulları: https://notefable.com/terms

## Russian

- **Подзаголовок**: Заметки, слайды и доски
- **Рекламный текст**: Спросите ИИ о чём угодно, а ответ сохраните как заметку, покажите как слайды или попросите ИИ нарисовать его схемой на доске.
- **Ключевые слова**: учеба,блокнот,презентация,схема,майнд-карта,ассистент,конспект,домашка,pdf,markdown,студент
- **Цена в iOS**: Бесплатно, с дневными и месячными лимитами на сообщения и изображения ИИ и 500 MB для ваших файлов после входа. NoteFable Pro (ежемесячная подписка с автопродлением) повышает лимиты до 2000 сообщений и 60 изображений в месяц (до 10 изображений в день), а хранилище — до 10 GB. Цена показывается в приложении до оформления. Оплата списывается с вашей учётной записи Apple, подписка продлевается автоматически, если не отменить её как минимум за 24 часа до конца периода; управлять подпиской и отменить её можно в настройках учётной записи Apple. Без рекламы. Условия использования: https://notefable.com/terms
