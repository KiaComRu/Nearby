export const origin = 'https://nearby.kiacom.ru';
export const locales = ['ru', 'en', 'hi', 'zh-CN', 'es'];
export const languageNames = {ru:'Русский', en:'English', hi:'हिन्दी', 'zh-CN':'简体中文', es:'Español'};
export const hreflang = language => language === 'zh-CN' ? 'zh-Hans' : language;
export const canonical = language => origin + '/web/' + (language === 'ru' ? '' : '?lang=' + language);
export const escape = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
export const copy = {
  ru: {
    title:'Бесплатно передать файл с телефона на телефон, ПК и планшет — Nearby',
    description:'Бесплатно передать файл с телефона на телефон, ПК, компьютер или планшет через Nearby. Android, iPhone и iPad: QR, ссылка или ID, без регистрации.',
    h1:'Передать файл бесплатно — на телефон, ПК или планшет',
    lead:'Nearby — бесплатная передача файлов с телефона на телефон, ПК, компьютер и планшет. Подключите устройства по QR, ссылке или ID.',
    badge:'БЕСПЛАТНО · ВЕБ-ПРИЛОЖЕНИЕ', summary:'Как бесплатно передать файл с телефона',
    answer:'Откройте Nearby на двух устройствах, создайте приглашение и подключитесь по QR-коду, ссылке или девятизначному ID. Подтвердите устройство и выберите файл на телефоне. Получение начнётся автоматически; сохраните файл на принимающем устройстве до закрытия страницы.',
    stepsTitle:'Бесплатная передача файла за четыре шага',
    steps:['Откройте эту страницу на телефоне и устройстве, которое получит файл.','Создайте приглашение, откройте ссылку или отсканируйте QR-код вторым устройством. Можно ввести все 9 цифр ID.','Подтвердите подключение на устройстве с приглашением. На телефоне выберите получателя и файл.','Дождитесь получения. Откройте или сохраните принятый файл из списка; на iPhone и iPad нажмите значок открытия файла.'],
    faqTitle:'Вопросы о бесплатной передаче файлов', languages:'Nearby бесплатно на других языках',
    free:'Бесплатно', appName:'Nearby — бесплатная передача файлов', home:'Главная Nearby', web:'Бесплатная веб-версия',
    faq:[
      ['Как бесплатно передать файл с телефона на телефон?','Откройте Nearby в браузере обоих телефонов, создайте приглашение и подключите второй телефон по QR, ссылке или ID. Подтвердите устройство и выберите файл. Подходят Android и iPhone, в том числе в разных Wi-Fi или через мобильный интернет. Устанавливать приложение и регистрироваться не нужно.'],
      ['Как бесплатно передать файл с телефона на ПК?','Откройте эту страницу на телефоне и Windows-ПК. Создайте приглашение на ПК и отсканируйте его QR-код камерой телефона или введите ID. Подтвердите подключение на ПК, затем выберите и отправьте файл с телефона. Кабель и установка программы не требуются.'],
      ['Как бесплатно передать файл с телефона на компьютер?','Nearby работает в браузере компьютера с Windows, macOS или Linux. Откройте Nearby на компьютере и телефоне, соедините устройства по приглашению и отправьте файл. Это бесплатный способ передачи без USB-кабеля и без учётной записи.'],
      ['Как бесплатно передать файл с телефона на планшет?','Откройте Nearby на телефоне и Android-планшете или iPad, создайте приглашение и подключите второе устройство. Выберите файл на телефоне. На iPad откройте полученный файл из списка и сохраните его через меню Safari. Во время передачи держите страницы открытыми.'],
      ['Nearby действительно бесплатно?','Да. Веб-версия Nearby бесплатна: регистрация, подписка и оплата за передачу не нужны. Для подключения оба устройства должны иметь доступ к интернету. Сервис выбирает прямое соединение, а при его недоступности — зашифрованный интернет-канал.'],
      ['Какой размер файла можно передать бесплатно?','Для обычного получения в браузере телефона и для интернет-канала лимит составляет 100 МиБ на файл. При прямом соединении с Chrome или Edge на ПК и заранее выбранной папкой получения доступно до 10 ГиБ. Точный лимит получателя отображается перед отправкой.'],
      ['Можно бесплатно передавать файлы между разными сетями?','Да. Nearby автоматически проверяет прямое соединение и при необходимости использует интернет-канал со сквозным шифрованием. Оставьте Nearby открытым на обоих устройствах, не блокируйте телефон и сохраните полученный файл до закрытия страницы.'],
    ],
  },
  en: {
    title:'Send files from phone to phone, PC or tablet for free — Nearby',
    description:'Send files from your phone to another phone, PC, computer or tablet for free. Nearby works on Android, iPhone and iPad via QR, link or ID. No sign-up.',
    h1:'Send files to a phone, PC or tablet for free',
    lead:'Nearby offers free file transfer from phone to phone, PC, computer and tablet. Connect with a QR code, link or ID.',
    badge:'FREE · WEB APP', summary:'How to send a file from your phone for free',
    answer:'Open Nearby on both devices, create an invitation and connect using a QR code, link or nine-digit ID. Confirm the device and choose a file on your phone. Receiving starts automatically. Save the received file before closing the page.',
    stepsTitle:'Free file transfer in four steps',
    steps:['Open this page on your phone and the receiving device.','Create an invitation and open its link or scan the QR code on the second device. You can also enter all 9 digits of the ID.','Confirm the connection on the inviting device. Choose the recipient and file on your phone.','Wait for the file to arrive, then open or save it from the list. On iPhone and iPad, tap the open-file icon.'],
    faqTitle:'Free file transfer questions', languages:'Use Nearby for free in other languages',
    free:'Free', appName:'Nearby — free file transfer', home:'Nearby home', web:'Free web app',
    faq:[
      ['How can I send a file from phone to phone for free?','Open Nearby in both phones’ browsers, create an invitation and connect the second phone using a QR code, link or ID. Confirm the device and choose your file. Android and iPhone are supported, including different Wi-Fi networks or mobile data. No app installation or sign-up is required.'],
      ['How can I send a file from my phone to a PC for free?','Open this page on your phone and Windows PC. Create an invitation on the PC, then scan its QR code with your phone camera or enter the ID. Confirm the connection on the PC and send the file from your phone. No cable or software installation is required.'],
      ['How can I transfer a file from my phone to a computer for free?','Nearby runs in a browser on Windows, macOS and Linux. Open Nearby on your computer and phone, connect them with an invitation and send your file. File transfer is free and requires neither a USB cable nor an account.'],
      ['How can I send a file from my phone to a tablet for free?','Open Nearby on your phone and Android tablet or iPad, create an invitation and connect the second device. Choose the file on your phone. On iPad, open the received file from the list and save it using Safari’s sharing menu. Keep both pages open during transfer.'],
      ['Is Nearby really free?','Yes. The Nearby web app is free: no registration, subscription or transfer fee. Both devices need internet access to connect. Nearby selects a direct connection when available and otherwise uses an encrypted internet channel.'],
      ['How large a file can I transfer for free?','Normal receiving in a phone browser and the internet channel support up to 100 MiB per file. A direct connection to Chrome or Edge on a PC with a receiving folder selected in advance supports up to 10 GiB. The recipient’s actual limit is shown before sending.'],
      ['Can I transfer files between different networks for free?','Yes. Nearby automatically checks for a direct connection and falls back to an end-to-end encrypted internet channel when needed. Keep Nearby open on both devices, keep your phone unlocked and save the received file before closing the page.'],
    ],
  },
  hi: {
    title:'फ़ोन से फ़ोन, PC या टैबलेट पर फ़ाइल मुफ़्त भेजें — Nearby',
    description:'Nearby से फ़ोन से दूसरे फ़ोन, PC, कंप्यूटर या टैबलेट पर फ़ाइल मुफ़्त भेजें। Android, iPhone और iPad पर QR, लिंक या ID से जुड़ें। पंजीकरण नहीं।',
    h1:'फ़ोन, PC या टैबलेट पर फ़ाइल मुफ़्त भेजें',
    lead:'Nearby से फ़ोन से फ़ोन, PC, कंप्यूटर और टैबलेट पर फ़ाइलें मुफ़्त भेजें। QR कोड, लिंक या ID से डिवाइस जोड़ें।',
    badge:'मुफ़्त · वेब ऐप', summary:'फ़ोन से फ़ाइल मुफ़्त कैसे भेजें',
    answer:'दोनों डिवाइस पर Nearby खोलें, आमंत्रण बनाएँ और QR कोड, लिंक या नौ अंकों की ID से जुड़ें। डिवाइस की पुष्टि करें और फ़ोन पर फ़ाइल चुनें। फ़ाइल अपने आप प्राप्त होगी। पेज बंद करने से पहले मिली फ़ाइल सहेजें।',
    stepsTitle:'चार चरणों में मुफ़्त फ़ाइल ट्रांसफ़र',
    steps:['फ़ोन और फ़ाइल प्राप्त करने वाले डिवाइस पर यह पेज खोलें।','आमंत्रण बनाएँ। दूसरे डिवाइस पर उसका लिंक खोलें या QR कोड स्कैन करें। ID के सभी 9 अंक भी डाल सकते हैं।','आमंत्रण बनाने वाले डिवाइस पर कनेक्शन की पुष्टि करें। फ़ोन पर प्राप्तकर्ता और फ़ाइल चुनें।','फ़ाइल मिलने तक प्रतीक्षा करें, फिर सूची से खोलें या सहेजें। iPhone और iPad पर फ़ाइल खोलने का आइकन दबाएँ।'],
    faqTitle:'मुफ़्त फ़ाइल ट्रांसफ़र के सवाल', languages:'दूसरी भाषाओं में Nearby मुफ़्त इस्तेमाल करें',
    free:'मुफ़्त', appName:'Nearby — मुफ़्त फ़ाइल ट्रांसफ़र', home:'Nearby होम', web:'मुफ़्त वेब ऐप',
    faq:[
      ['फ़ोन से फ़ोन पर फ़ाइल मुफ़्त कैसे भेजें?','दोनों फ़ोन के ब्राउज़र में Nearby खोलें। आमंत्रण बनाएँ और दूसरे फ़ोन को QR, लिंक या ID से जोड़ें। डिवाइस की पुष्टि करके फ़ाइल चुनें। Android और iPhone, अलग Wi-Fi और मोबाइल इंटरनेट पर भी काम करते हैं। ऐप इंस्टॉल या पंजीकरण ज़रूरी नहीं।'],
      ['फ़ोन से PC पर फ़ाइल मुफ़्त कैसे भेजें?','फ़ोन और Windows PC पर यह पेज खोलें। PC पर आमंत्रण बनाएँ और फ़ोन के कैमरे से QR स्कैन करें या ID डालें। PC पर कनेक्शन की पुष्टि करें और फ़ोन से फ़ाइल भेजें। केबल या सॉफ़्टवेयर इंस्टॉल करना ज़रूरी नहीं।'],
      ['फ़ोन से कंप्यूटर पर फ़ाइल मुफ़्त कैसे भेजें?','Nearby Windows, macOS और Linux के ब्राउज़र में चलता है। कंप्यूटर और फ़ोन पर Nearby खोलें, आमंत्रण से जुड़ें और फ़ाइल भेजें। यह मुफ़्त ट्रांसफ़र है; USB केबल या खाता नहीं चाहिए।'],
      ['फ़ोन से टैबलेट पर फ़ाइल मुफ़्त कैसे भेजें?','फ़ोन और Android टैबलेट या iPad पर Nearby खोलें, आमंत्रण बनाएँ और दूसरे डिवाइस को जोड़ें। फ़ोन पर फ़ाइल चुनें। iPad पर मिली फ़ाइल सूची से खोलें और Safari के शेयर मेन्यू से सहेजें। ट्रांसफ़र के समय दोनों पेज खुले रखें।'],
      ['क्या Nearby सच में मुफ़्त है?','हाँ। Nearby वेब ऐप मुफ़्त है: पंजीकरण, सदस्यता या फ़ाइल भेजने का शुल्क नहीं है। जुड़ने के लिए दोनों डिवाइस पर इंटरनेट चाहिए। Nearby उपलब्ध होने पर सीधा कनेक्शन चुनता है, वरना एन्क्रिप्टेड इंटरनेट चैनल इस्तेमाल करता है।'],
      ['कितनी बड़ी फ़ाइल मुफ़्त भेज सकते हैं?','फ़ोन के ब्राउज़र में सामान्य प्राप्ति और इंटरनेट चैनल पर प्रति फ़ाइल सीमा 100 MiB है। PC पर Chrome या Edge में पहले से प्राप्ति फ़ोल्डर चुनकर सीधे कनेक्शन से 10 GiB तक मिल सकता है। भेजने से पहले प्राप्तकर्ता की वास्तविक सीमा दिखाई जाती है।'],
      ['क्या अलग नेटवर्क के बीच फ़ाइलें मुफ़्त भेज सकते हैं?','हाँ। Nearby पहले सीधा कनेक्शन जाँचता है और ज़रूरत पड़ने पर एंड-टू-एंड एन्क्रिप्टेड इंटरनेट चैनल चुनता है। दोनों डिवाइस पर Nearby खुला रखें, फ़ोन लॉक न करें और पेज बंद करने से पहले मिली फ़ाइल सहेजें।'],
    ],
  },
  'zh-CN': {
    title:'免费从手机传文件到手机、电脑或平板 — Nearby',
    description:'使用 Nearby 免费从手机传文件到另一部手机、PC、电脑或平板。支持 Android、iPhone 和 iPad，在浏览器中通过二维码、链接或 ID 连接，无需注册。',
    h1:'免费传文件到手机、电脑或平板',
    lead:'Nearby 支持免费从手机传文件到手机、PC、电脑和平板。通过二维码、链接或 ID 连接设备。',
    badge:'免费 · 网页应用', summary:'如何免费从手机发送文件',
    answer:'在两台设备上打开 Nearby，创建邀请，并通过二维码、链接或九位数字 ID 连接。确认设备后，在手机上选择文件。接收会自动开始；关闭页面前请保存已接收文件。',
    stepsTitle:'免费传文件的四个步骤',
    steps:['在手机和接收设备上打开此页面。','创建邀请，在另一台设备上打开链接或扫描二维码，也可以输入完整的九位 ID。','在创建邀请的设备上确认连接，然后在手机上选择接收方和文件。','等待接收完成，从列表中打开或保存文件。在 iPhone 和 iPad 上，点按打开文件图标。'],
    faqTitle:'免费文件传输常见问题', languages:'使用其他语言免费体验 Nearby',
    free:'免费', appName:'Nearby — 免费文件传输', home:'Nearby 首页', web:'免费网页版',
    faq:[
      ['如何免费从手机传文件到另一部手机？','在两部手机的浏览器中打开 Nearby，创建邀请，并通过二维码、链接或 ID 连接第二部手机。确认设备并选择文件。支持 Android 和 iPhone，可在不同 Wi-Fi 或移动网络间使用，无需安装应用或注册。'],
      ['如何免费从手机传文件到 PC？','在手机和 Windows PC 上打开此页面。在 PC 上创建邀请，用手机相机扫描二维码或输入 ID。在 PC 上确认连接，再从手机选择并发送文件，无需数据线或安装软件。'],
      ['如何免费从手机传文件到电脑？','Nearby 可在 Windows、macOS 和 Linux 的浏览器中使用。在电脑和手机上打开 Nearby，通过邀请连接后发送文件。传输免费，无需 USB 数据线或账号。'],
      ['如何免费从手机传文件到平板？','在手机及 Android 平板或 iPad 上打开 Nearby，创建邀请并连接另一台设备。在手机上选择文件。在 iPad 上，从列表打开收到的文件，再用 Safari 的分享菜单保存。传输期间请保持两个页面打开。'],
      ['Nearby 真的免费吗？','是的。Nearby 网页应用免费使用，无需注册、订阅或支付传输费用。连接时两台设备都需要联网。Nearby 会优先使用直连，不可用时改用加密互联网通道。'],
      ['可以免费传多大的文件？','手机浏览器的普通接收和互联网通道支持每个文件最多 100 MiB。接收端为 PC 上的 Chrome 或 Edge，并提前选择接收文件夹时，直连可支持最多 10 GiB。发送前会显示接收方的实际限制。'],
      ['不同网络之间也能免费传文件吗？','可以。Nearby 自动检查直连，必要时切换到端到端加密的互联网通道。请在两台设备上保持 Nearby 打开，不要锁定手机，并在关闭页面前保存收到的文件。'],
    ],
  },
  es: {
    title:'Enviar archivos del móvil a otro móvil, PC o tablet gratis — Nearby',
    description:'Envía archivos del móvil a otro móvil, PC, ordenador o tablet gratis con Nearby. Android, iPhone y iPad: conecta por QR, enlace o ID, sin registro.',
    h1:'Envía archivos a un móvil, PC o tablet gratis',
    lead:'Nearby permite transferir archivos gratis del móvil a otro móvil, PC, ordenador y tablet. Conecta por código QR, enlace o ID.',
    badge:'GRATIS · APLICACIÓN WEB', summary:'Cómo enviar un archivo del móvil gratis',
    answer:'Abre Nearby en ambos dispositivos, crea una invitación y conecta mediante QR, enlace o ID de nueve cifras. Confirma el dispositivo y elige el archivo en el móvil. La recepción comienza automáticamente. Guarda el archivo antes de cerrar la página.',
    stepsTitle:'Transferencia de archivos gratis en cuatro pasos',
    steps:['Abre esta página en el móvil y en el dispositivo receptor.','Crea una invitación y abre su enlace o escanea el QR desde el segundo dispositivo. También puedes introducir las 9 cifras del ID.','Confirma la conexión en el dispositivo que creó la invitación. Elige el destinatario y el archivo en el móvil.','Espera a que termine la recepción y abre o guarda el archivo desde la lista. En iPhone y iPad, toca el icono para abrir el archivo.'],
    faqTitle:'Preguntas sobre la transferencia de archivos gratis', languages:'Usa Nearby gratis en otros idiomas',
    free:'Gratis', appName:'Nearby — transferencia de archivos gratis', home:'Inicio de Nearby', web:'Aplicación web gratis',
    faq:[
      ['¿Cómo enviar un archivo de un móvil a otro gratis?','Abre Nearby en el navegador de ambos móviles, crea una invitación y conecta el segundo móvil por QR, enlace o ID. Confirma el dispositivo y elige el archivo. Funciona en Android y iPhone, incluso con distintas redes Wi-Fi o datos móviles. No necesitas instalar una app ni registrarte.'],
      ['¿Cómo enviar un archivo del móvil a un PC gratis?','Abre esta página en el móvil y en el PC con Windows. Crea una invitación en el PC y escanea su QR con la cámara del móvil o introduce el ID. Confirma la conexión en el PC y envía el archivo desde el móvil. No necesitas cable ni instalar software.'],
      ['¿Cómo transferir un archivo del móvil al ordenador gratis?','Nearby funciona en el navegador de Windows, macOS y Linux. Abre Nearby en el ordenador y en el móvil, conéctalos con una invitación y envía el archivo. La transferencia es gratis y no requiere cable USB ni cuenta.'],
      ['¿Cómo enviar un archivo del móvil a una tablet gratis?','Abre Nearby en el móvil y en la tablet Android o iPad, crea una invitación y conecta el otro dispositivo. Elige el archivo en el móvil. En iPad, abre el archivo recibido desde la lista y guárdalo con el menú de compartir de Safari. Mantén ambas páginas abiertas durante la transferencia.'],
      ['¿Nearby es realmente gratis?','Sí. La aplicación web Nearby es gratis: no requiere registro, suscripción ni pago por transferencia. Ambos dispositivos necesitan internet para conectarse. Nearby elige una conexión directa si está disponible o, en caso contrario, un canal de internet cifrado.'],
      ['¿Qué tamaño de archivo puedo transferir gratis?','La recepción normal en el navegador del móvil y el canal de internet admiten hasta 100 MiB por archivo. Una conexión directa a Chrome o Edge en un PC con una carpeta de recepción elegida previamente permite hasta 10 GiB. El límite real del receptor se muestra antes de enviar.'],
      ['¿Puedo transferir archivos gratis entre redes diferentes?','Sí. Nearby comprueba automáticamente la conexión directa y utiliza un canal de internet con cifrado de extremo a extremo cuando hace falta. Mantén Nearby abierto en ambos dispositivos, el móvil desbloqueado y guarda el archivo recibido antes de cerrar la página.'],
    ],
  },
};

export function guideContent(language) {
  const c=copy[language];
  return `<summary>${escape(c.summary)}</summary><div class="web-search-content"><p class="web-search-answer">${escape(c.answer)}</p><h2>${escape(c.stepsTitle)}</h2><ol>${c.steps.map(step=>`<li>${escape(step)}</li>`).join('')}</ol><h2>${escape(c.faqTitle)}</h2>${c.faq.map(([question,answer])=>`<details class="web-search-question"><summary>${escape(question)}</summary><p>${escape(answer)}</p></details>`).join('')}<nav class="web-search-languages" aria-label="${escape(c.languages)}">${locales.map(locale=>`<a href="${canonical(locale)}" hreflang="${hreflang(locale)}" lang="${locale}" data-seo-language="${locale}"${locale===language?' aria-current="page"':''}>${escape(languageNames[locale])} · ${escape(copy[locale].free)}</a>`).join('')}</nav></div>`;
}

export function structuredData(language,version) {
  const c=copy[language],url=canonical(language);
  return {'@context':'https://schema.org','@graph':[
    {'@type':'Organization','@id':origin+'/#publisher',name:'Dev.KiaCom',url:origin+'/'},
    {'@type':'WebPage','@id':url+'#page',url,name:c.title,description:c.description,inLanguage:language,isAccessibleForFree:true,about:{'@id':url+'#app'},breadcrumb:{'@id':url+'#breadcrumbs'}},
    {'@type':'WebApplication','@id':url+'#app',name:'Nearby',alternateName:c.appName,url,description:c.description,inLanguage:language,applicationCategory:'UtilitiesApplication',operatingSystem:'Android, iOS, iPadOS, Windows, macOS, Linux',softwareVersion:version,isAccessibleForFree:true,offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},creator:{'@id':origin+'/#publisher'},featureList:c.faq.slice(0,4).map(([question])=>question)},
    {'@type':'FAQPage','@id':url+'#faq',inLanguage:language,isPartOf:{'@id':url+'#page'},mainEntity:c.faq.map(([name,text])=>({'@type':'Question',name,acceptedAnswer:{'@type':'Answer',text}}))},
    {'@type':'BreadcrumbList','@id':url+'#breadcrumbs',itemListElement:[{'@type':'ListItem',position:1,name:c.home,item:origin+'/'},{'@type':'ListItem',position:2,name:c.web,item:url}]},
  ]};
}
