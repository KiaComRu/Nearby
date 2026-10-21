(() => {
  'use strict';
  const languages = ['en', 'hi', 'zh-CN', 'es'];
  const supported = ['ru', ...languages];
  const rows = [
    ['Проверьте ID: нужны все 9 цифр.', 'Check the ID: enter all 9 digits.', 'ID जाँचें: सभी 9 अंक डालें।', '请检查 ID：输入完整的 9 位数字。', 'Comprueba el ID: introduce los 9 dígitos.'],
    ['123-456-789 или ссылка', '123-456-789 or a link', '123-456-789 या लिंक', '123-456-789 或链接', '123-456-789 o enlace'],
    ['Некорректный ключ устройства. Создайте новое приглашение.', 'Invalid device key. Create a new invitation.', 'डिवाइस की कुंजी सही नहीं है। नया आमंत्रण बनाएँ।', '设备密钥无效，请创建新邀请。', 'Clave de dispositivo no válida. Crea una invitación nueva.'],
    ['Подтверждать подключение по QR-коду или ссылке', 'Confirm connection from a QR code or link', 'QR कोड या लिंक से कनेक्शन की पुष्टि करें', '通过二维码或链接连接前确认', 'Confirmar la conexión desde un QR o enlace'],
    ['Восстанавливаем соединение', 'Reconnecting', 'फिर से कनेक्ट हो रहा है', '正在恢复连接', 'Reconectando'],
    ['Прямой канал недоступен. Переключаемся на зашифрованный интернет-канал.', 'Direct connection is unavailable. Switching to an encrypted internet channel.', 'सीधा कनेक्शन उपलब्ध नहीं है। एन्क्रिप्टेड इंटरनेट चैनल पर जा रहे हैं।', '直连不可用，正在切换到加密互联网通道。', 'La conexión directa no está disponible. Cambiando a un canal de internet cifrado.'],
    ['Проверяем соединение с другим устройством…', 'Checking the connection to the other device…', 'दूसरे डिवाइस से कनेक्शन जाँचा जा रहा है…', '正在检查与另一台设备的连接…', 'Comprobando la conexión con el otro dispositivo…'],
    ['Прямое соединение прервано. Отправьте незавершённый файл заново после восстановления связи.', 'Direct connection interrupted. Send the unfinished file again after reconnection.', 'सीधा कनेक्शन टूट गया। कनेक्शन लौटने पर अधूरी फ़ाइल दोबारा भेजें।', '直连已中断，连接恢复后请重新发送未完成的文件。', 'La conexión directa se ha interrumpido. Vuelve a enviar el archivo incompleto tras reconectar.'],
    ['Дополнительные настройки', 'Advanced settings', 'अतिरिक्त सेटिंग', '高级设置', 'Ajustes avanzados'],
    ['Способ подключения', 'Connection method', 'कनेक्शन का तरीका', '连接方式', 'Método de conexión'],
    ['Автоматически — рекомендуем', 'Automatic — recommended', 'अपने आप — अनुशंसित', '自动选择（推荐）', 'Automático — recomendado'],
    ['Соединение выбирается автоматически: напрямую, а если недоступно — через зашифрованный интернет-канал (до 100 МиБ на файл).', 'Connection is selected automatically: direct when available, otherwise an encrypted internet channel (up to 100 MiB per file).', 'कनेक्शन अपने आप चुना जाता है: सीधे, या उपलब्ध न होने पर एन्क्रिप्टेड इंटरनेट चैनल (प्रति फ़ाइल 100 MiB तक)।', '自动选择连接：优先直连，否则使用加密互联网通道（每个文件上限 100 MiB）。', 'La conexión se elige automáticamente: directa si está disponible, o por un canal de internet cifrado (hasta 100 MiB por archivo).'],
    ['Nearby автоматически выбирает прямое или интернет-соединение.', 'Nearby automatically selects a direct or internet connection.', 'Nearby अपने आप सीधा या इंटरनेट कनेक्शन चुनता है।', 'Nearby 自动选择直连或互联网连接。', 'Nearby elige automáticamente una conexión directa o por internet.'],
    ['Обновите страницу на обоих устройствах и создайте новое приглашение.', 'Refresh both devices and create a new invitation.', 'दोनों डिवाइस पर पेज रीफ़्रेश करके नया आमंत्रण बनाएँ।', '请刷新两台设备的页面并创建新邀请。', 'Actualiza ambos dispositivos y crea una invitación nueva.'],
    ['Прямое соединение прервано. Создайте новое подключение.', 'Direct connection interrupted. Create a new connection.', 'सीधा कनेक्शन टूट गया। नया कनेक्शन बनाएँ।', '直连已中断，请创建新连接。', 'La conexión directa se ha interrumpido. Crea una nueva.'],
    ['Прямое соединение не удалось. Создайте новое подключение.', 'Direct connection failed. Create a new connection.', 'सीधा कनेक्शन नहीं बना। नया कनेक्शन बनाएँ।', '直连失败，请创建新连接。', 'La conexión directa ha fallado. Crea una nueva.'],
    ['Папка выбрана.', 'Folder selected.', 'फ़ोल्डर चुना गया।', '已选择文件夹。', 'Carpeta elegida.'],
    ['Устройства рядом: поиск ПК доступен в приложении Windows. В браузере подключайтесь по ID, QR-коду или ссылке.', 'Nearby devices: PC discovery is available in the Windows app. In a browser, use an ID, QR code or link.', 'पास के डिवाइस: PC खोज Windows ऐप में उपलब्ध है। ब्राउज़र में ID, QR या लिंक इस्तेमाल करें।', '附近设备：Windows 应用支持查找电脑。浏览器请使用 ID、二维码或链接。', 'Dispositivos cercanos: la búsqueda de PC está en la aplicación Windows. En el navegador utiliza un ID, QR o enlace.'],
    ['Введите ID или вставьте ссылку с другого устройства.', 'Enter an ID or paste the link from the other device.', 'ID डालें या दूसरे डिवाइस का लिंक पेस्ट करें।', '输入 ID 或粘贴另一台设备的链接。', 'Introduce el ID o pega el enlace del otro dispositivo.'],
    ['ID или ссылка с другого устройства', 'ID or link from the other device', 'दूसरे डिवाइस का ID या लिंक', '另一台设备的 ID 或链接', 'ID o enlace del otro dispositivo'],
    ['Введите ID или вставьте ссылку', 'Enter an ID or paste a link', 'ID डालें या लिंक पेस्ट करें', '输入 ID 或粘贴链接', 'Introduce el ID o pega un enlace'],
    ['ID подключения', 'Connection ID', 'कनेक्शन ID', '连接 ID', 'ID de conexión'],
    ['Скопировать ID', 'Copy ID', 'ID कॉपी करें', '复制 ID', 'Copiar ID'],
    ['Одно приглашение · 15 минут', 'One invitation · 15 minutes', 'एक आमंत्रण · 15 मिनट', '一次邀请 · 15 分钟', 'Una invitación · 15 minutos'],
    ['ID скопирован ✓', 'ID copied ✓', 'ID कॉपी हुआ ✓', 'ID 已复制 ✓', 'ID copiado ✓'],
    ['Скопируйте выделенный ID.', 'Copy the selected ID.', 'चुना हुआ ID कॉपी करें।', '复制选中的 ID。', 'Copia el ID seleccionado.'],
    ['Проверьте ID: нужны все 26 букв и цифр.', 'Check the ID: enter all 26 letters and digits.', 'ID जाँचें: सभी 26 अक्षर और अंक डालें।', '请检查 ID：输入完整的 26 个字母和数字。', 'Comprueba el ID: introduce los 26 caracteres.'],
    ['Некорректный ID приглашения.', 'Invalid invitation ID.', 'आमंत्रण ID सही नहीं है।', '邀请 ID 无效。', 'ID de invitación no válido.'],
    ['Слишком много попыток ввода ID. Подождите минуту.', 'Too many ID attempts. Wait a minute.', 'ID के बहुत अधिक प्रयास। एक मिनट रुकें।', 'ID 尝试次数过多，请等待一分钟。', 'Demasiados intentos de ID. Espera un minuto.'],
    ['Этот ID уже используется. Создайте новое подключение.', 'This ID is already in use. Create a new connection.', 'यह ID इस्तेमाल हो रहा है। नया कनेक्शन बनाएँ।', '此 ID 已被使用，请创建新连接。', 'Este ID ya está en uso. Crea una conexión nueva.'],
    ['ID не найден, истёк или уже использован. Создайте новое приглашение.', 'ID not found, expired or already used. Create a new invitation.', 'ID नहीं मिला, समाप्त हुआ या इस्तेमाल हो चुका है। नया आमंत्रण बनाएँ।', 'ID 不存在、已过期或已使用，请创建新邀请。', 'ID no encontrado, caducado o ya utilizado. Crea una invitación nueva.'],
    ['Срок приглашения истёк. Создайте новое подключение.', 'Invitation expired. Create a new connection.', 'आमंत्रण समाप्त हुआ। नया कनेक्शन बनाएँ।', '邀请已过期，请创建新连接。', 'La invitación ha caducado. Crea una conexión nueva.'],
    ['Приём автоматический · до 100 МиБ. Сохраните файлы перед закрытием.', 'Automatic receiving · up to 100 MiB. Save files before closing.', 'अपने आप प्राप्त करें · 100 MiB तक। बंद करने से पहले फ़ाइलें सेव करें।', '自动接收 · 上限 100 MiB。关闭页面前请保存文件。', 'Recepción automática · hasta 100 MiB. Guarda los archivos antes de cerrar.'],
    ['Подключение', 'Connection', 'कनेक्शन', '连接', 'Conexión'],
    ['Передача', 'Transfer', 'ट्रांसफ़र', '传输', 'Transferencia'],
    ['Работа с устройствами', 'Device workspace', 'डिवाइस कार्यक्षेत्र', '设备工作区', 'Área de dispositivos'],
    ['Файлы между устройствами', 'Files between devices', 'डिवाइस के बीच फ़ाइलें', '设备间文件传输', 'Archivos entre dispositivos'],
    ['Подключитесь один раз — передавайте без подтверждения каждого файла.', 'Connect once. Receive files automatically.', 'एक बार कनेक्ट करें। फ़ाइलें अपने आप प्राप्त होंगी।', '连接一次，自动接收文件。', 'Conecta una vez y recibe archivos automáticamente.'],
    ['Подключиться', 'Connect', 'कनेक्ट करें', '连接设备', 'Conectar'],
    ['Пригласить', 'Invite', 'आमंत्रित करें', '邀请设备', 'Invitar'],
    ['Вставьте полную ссылку с другого устройства.', 'Paste the full link from the other device.', 'दूसरे डिवाइस का पूरा लिंक पेस्ट करें।', '粘贴另一台设备的完整链接。', 'Pega el enlace completo del otro dispositivo.'],
    ['Создайте приглашение и откройте его на втором устройстве.', 'Create an invitation and open it on the other device.', 'आमंत्रण बनाएँ और दूसरे डिवाइस पर खोलें।', '创建邀请，在另一台设备上打开。', 'Crea una invitación y ábrela en el otro dispositivo.'],
    ['Устройства рядом: поиск ПК доступен в приложении Windows. В браузере подключайтесь по QR-коду или ссылке.', 'Nearby devices: PC discovery is available in the Windows app. In a browser, use a QR code or invitation link.', 'पास के डिवाइस: PC खोज Windows ऐप में उपलब्ध है। ब्राउज़र में QR या आमंत्रण लिंक इस्तेमाल करें।', '附近设备：Windows 应用支持查找电脑。浏览器请使用二维码或邀请链接。', 'Dispositivos cercanos: la búsqueda de PC está en la aplicación Windows. En el navegador utiliza un QR o enlace.'],
    ['Папка получения', 'Receive folder', 'प्राप्त फ़ाइलों का फ़ोल्डर', '接收文件夹', 'Carpeta de recepción'],
    ['Файлы загружаются автоматически после подключения.', 'Files download automatically after connection.', 'कनेक्शन के बाद फ़ाइलें अपने आप डाउनलोड होती हैं।', '连接后自动下载文件。', 'Los archivos se descargan automáticamente tras conectar.'],
    ['Приём без подтверждения.', 'Automatic receiving.', 'अपने आप प्राप्त करें।', '自动接收。', 'Recepción automática.'],
    ['ПОДКЛЮЧЁННОЕ УСТРОЙСТВО', 'CONNECTED DEVICE', 'कनेक्ट किया डिवाइस', '已连接设备', 'DISPOSITIVO CONECTADO'],
    ['Отправка файлов', 'Send files', 'फ़ाइल भेजें', '发送文件', 'Enviar archivos'],
    ['Получение файлов', 'Receive files', 'फ़ाइल प्राप्त करें', '接收文件', 'Recibir archivos'],
    ['О счётчике', 'About the counter', 'काउंटर की जानकारी', '计数说明', 'Sobre el contador'],
    ['Установить', 'Install', 'इंस्टॉल करें', '安装', 'Instalar'],
    ['Принимаем автоматически…', 'Receiving automatically…', 'अपने आप प्राप्त हो रहा है…', '正在自动接收…', 'Recibiendo automáticamente…'],
    ['Подготавливаем передачу…', 'Preparing transfer…', 'ट्रांसफ़र तैयार हो रहा है…', '正在准备传输…', 'Preparando transferencia…'],
    ['Файл принят. Загрузка началась автоматически.', 'File received. Download started automatically.', 'फ़ाइल मिली। डाउनलोड अपने आप शुरू हुआ।', '已接收文件，下载已自动开始。', 'Archivo recibido. La descarga empezó automáticamente.'],
    ['Сохранён в выбранную папку.', 'Saved in the selected folder.', 'चुने हुए फ़ोल्डर में सेव हुआ।', '已保存到所选文件夹。', 'Guardado en la carpeta elegida.'],
    ['Файлы сохраняются автоматически в выбранную папку.', 'Files save automatically to the selected folder.', 'फ़ाइलें चुने फ़ोल्डर में अपने आप सेव होती हैं।', '文件自动保存到所选文件夹。', 'Los archivos se guardan automáticamente en la carpeta elegida.'],
    ['Папка выбрана. Для файлов больше 100 МиБ создайте новое подключение.', 'Folder selected. Create a new connection for files over 100 MiB.', 'फ़ोल्डर चुना गया। 100 MiB से बड़ी फ़ाइल के लिए नया कनेक्शन बनाएँ।', '已选择文件夹。发送大于 100 MiB 的文件前请创建新连接。', 'Carpeta elegida. Crea una conexión nueva para archivos de más de 100 MiB.'],
    ['Выбор папки недоступен. Файлы будут загружаться через браузер.', 'Folder selection is unavailable. Files will download through the browser.', 'फ़ोल्डर चयन उपलब्ध नहीं है। फ़ाइलें ब्राउज़र से डाउनलोड होंगी।', '无法选择文件夹，文件将通过浏览器下载。', 'No se puede elegir carpeta. Los archivos se descargarán por el navegador.'],
    ['Не удалось сохранить файл.', 'Could not save the file.', 'फ़ाइल सेव नहीं हुई।', '无法保存文件。', 'No se pudo guardar el archivo.'],
    ['Приём автоматический. Можно один раз выбрать папку получения.', 'Receiving is automatic. You can choose a receive folder once.', 'फ़ाइलें अपने आप आती हैं। प्राप्ति का फ़ोल्डर एक बार चुन सकते हैं।', '自动接收文件，可一次性选择接收文件夹。', 'La recepción es automática. Puedes elegir la carpeta una vez.'],
    ['До 100 МиБ. Приём и загрузка начинаются автоматически. Если браузер остановил загрузку, нажмите «Сохранить файл».', 'Up to 100 MiB. Receiving and downloading start automatically. If the browser blocks the download, use Save file.', '100 MiB तक। प्राप्ति और डाउनलोड अपने आप शुरू होते हैं। ब्राउज़र रोके तो फ़ाइल सेव करें बटन दबाएँ।', '上限 100 MiB。自动接收并下载；如浏览器阻止下载，请点击保存文件。', 'Hasta 100 MiB. Recepción y descarga automáticas. Si el navegador bloquea la descarga, pulsa Guardar archivo.'],
    ['Nearby — передача в браузере', 'Nearby — browser file transfer', 'Nearby — ब्राउज़र से फ़ाइल ट्रांसफर', 'Nearby — 浏览器文件传输', 'Nearby — transferencia en el navegador'],
    ['Nearby — главная', 'Nearby — home', 'Nearby — होम', 'Nearby — 首页', 'Nearby — inicio'],
    ['БРАУЗЕРНАЯ ВЕРСИЯ · БЕТА', 'WEB VERSION · BETA', 'वेब संस्करण · बीटा', '网页版 · 测试版', 'VERSIÓN WEB · BETA'],
    ['ВАШИ УСТРОЙСТВА. РАССТОЯНИЕ НЕ МЕШАЕТ.', 'YOUR DEVICES. CONNECTED ACROSS NETWORKS.', 'आपके डिवाइस। दूरी बाधा नहीं।', '连接您的设备，不受网络距离限制。', 'TUS DISPOSITIVOS. LA DISTANCIA NO IMPIDE CONECTARLOS.'],
    ['Передавайте файлы.', 'Transfer your files.', 'अपनी फ़ाइलें भेजें।', '传输您的文件。', 'Transfiere archivos.'],
    ['Между сетями.', 'Across networks.', 'अलग नेटवर्क पर।', '跨网络连接。', 'Entre redes.'],
    ['В одной сети — напрямую. В разных сетях — через интернет.', 'Same network: direct. Different networks: over the internet.', 'एक नेटवर्क में सीधे। अलग नेटवर्क में इंटरनेट से।', '同一网络直接传输，不同网络通过互联网。', 'En la misma red, directamente. En redes distintas, por internet.'],
    ['Подключитесь по QR-коду или полной ссылке-приглашению.', 'Connect using a QR code or a complete invitation link.', 'QR कोड या पूरे आमंत्रण लिंक से जुड़ें।', '扫描二维码或打开完整邀请链接。', 'Conecta con un QR o el enlace completo de invitación.'],
    ['01 / НАЧНИТЕ ЗДЕСЬ', '01 / START HERE', '01 / यहाँ शुरू करें', '01 / 从这里开始', '01 / EMPIEZA AQUÍ'],
    ['Свяжите два устройства', 'Connect two devices', 'दो डिवाइस जोड़ें', '连接两台设备', 'Conecta dos dispositivos'],
    ['Подключение и каждый входящий файл подтверждаются получателем.', 'The recipient confirms the connection and each incoming file.', 'प्राप्तकर्ता कनेक्शन और हर आने वाली फ़ाइल की पुष्टि करता है।', '接收方须确认连接及每个传入文件。', 'El destinatario confirma la conexión y cada archivo entrante.'],
    ['Как соединить устройства', 'Connection mode', 'कनेक्शन मोड', '连接方式', 'Modo de conexión'],
    ['В одной локальной сети — напрямую', 'Same local network — direct', 'एक लोकल नेटवर्क — सीधे', '同一局域网 — 直接传输', 'Misma red local — directo'],
    ['Через интернет — любые доступные сети', 'Internet — different available networks', 'इंटरनेट — अलग उपलब्ध नेटवर्क', '互联网 — 不同可用网络', 'Internet — redes diferentes'],
    ['Имя устройства — можно изменить', 'Device name — editable', 'डिवाइस का नाम — बदल सकते हैं', '设备名称 — 可修改', 'Nombre del dispositivo — editable'],
    ['Название устройства', 'Device name', 'डिवाइस का नाम', '设备名称', 'Nombre del dispositivo'],
    ['Создать подключение', 'Create a connection', 'कनेक्शन बनाएँ', '创建连接', 'Crear conexión'],
    ['УЖЕ ЕСТЬ ПРИГЛАШЕНИЕ?', 'ALREADY HAVE AN INVITATION?', 'आमंत्रण पहले से है?', '已有邀请？', '¿YA TIENES UNA INVITACIÓN?'],
    ['Ссылка с другого устройства', 'Link from the other device', 'दूसरे डिवाइस का लिंक', '另一台设备的链接', 'Enlace del otro dispositivo'],
    ['Вставьте ссылку-приглашение', 'Paste the invitation link', 'आमंत्रण लिंक पेस्ट करें', '粘贴邀请链接', 'Pega el enlace de invitación'],
    ['Подключиться', 'Connect', 'जुड़ें', '连接', 'Conectar'],
    ['Подключиться к устройству', 'Connect to the device', 'डिवाइस से जुड़ें', '连接设备', 'Conectar al dispositivo'],
    ['02 / СОЕДИНЕНИЕ', '02 / CONNECTION', '02 / कनेक्शन', '02 / 连接', '02 / CONEXIÓN'],
    ['Ожидаем устройство', 'Waiting for the device', 'डिवाइस की प्रतीक्षा है', '等待设备', 'Esperando al dispositivo'],
    ['Откройте приглашение на втором устройстве.', 'Open the invitation on the second device.', 'दूसरे डिवाइस पर आमंत्रण खोलें।', '在第二台设备打开邀请。', 'Abre la invitación en el segundo dispositivo.'],
    ['QR-код приглашения', 'Invitation QR code', 'आमंत्रण का QR कोड', '邀请二维码', 'Código QR de invitación'],
    ['Сканируйте камерой телефона', 'Scan with your phone camera', 'फोन के कैमरे से स्कैन करें', '使用手机相机扫描', 'Escanea con la cámara del móvil'],
    ['или отправьте ссылку на другое устройство.', 'or send the link to your other device.', 'या लिंक दूसरे डिवाइस को भेजें।', '或将链接发送到另一台设备。', 'o envía el enlace al otro dispositivo.'],
    ['Скопировать приглашение ↗', 'Copy invitation ↗', 'आमंत्रण कॉपी करें ↗', '复制邀请 ↗', 'Copiar invitación ↗'],
    ['Ссылка-приглашение', 'Invitation link', 'आमंत्रण लिंक', '邀请链接', 'Enlace de invitación'],
    ['Ссылка открывает доступ к подключению. Делитесь ею только с получателем.', 'The link grants access to the connection. Share it only with your recipient.', 'लिंक कनेक्शन तक पहुँच देता है। सिर्फ प्राप्तकर्ता से साझा करें।', '链接可用于加入连接，请仅分享给预期接收方。', 'El enlace permite acceder a la conexión. Compártelo solo con el destinatario.'],
    ['хочет подключиться.', 'wants to connect.', 'जुड़ना चाहता है।', '想要连接。', 'quiere conectarse.'],
    ['Это моё устройство — разрешить', 'This is my device — allow', 'यह मेरा डिवाइस है — अनुमति दें', '这是我的设备 — 允许', 'Es mi dispositivo — permitir'],
    ['Отклонить и закрыть', 'Reject and close', 'अस्वीकार करें और बंद करें', '拒绝并关闭', 'Rechazar y cerrar'],
    ['Завершить соединение', 'End connection', 'कनेक्शन समाप्त करें', '结束连接', 'Finalizar conexión'],
    ['03 / ФАЙЛЫ', '03 / FILES', '03 / फ़ाइलें', '03 / 文件', '03 / ARCHIVOS'],
    ['Отправляйте и принимайте', 'Send and receive', 'भेजें और प्राप्त करें', '发送与接收', 'Envía y recibe'],
    ['Ожидаем соединение', 'Waiting for connection', 'कनेक्शन की प्रतीक्षा है', '等待连接', 'Esperando conexión'],
    ['Выберите файлы', 'Choose files', 'फ़ाइलें चुनें', '选择文件', 'Elige archivos'],
    ['или перетащите их сюда', 'or drag them here', 'या यहाँ खींचकर छोड़ें', '或拖到此处', 'o arrástralos aquí'],
    ['Размер зависит от браузера получателя', 'Size depends on the receiving browser', 'आकार प्राप्तकर्ता के ब्राउज़र पर निर्भर है', '大小限制取决于接收方浏览器', 'El tamaño depende del navegador receptor'],
    ['Здесь появятся входящие и исходящие файлы.', 'Incoming and outgoing files will appear here.', 'आने और जाने वाली फ़ाइलें यहाँ दिखेंगी।', '传入和传出的文件将显示在这里。', 'Aquí aparecerán los archivos entrantes y salientes.'],
    ['Уже передано через Nearby', 'Already transferred with Nearby', 'Nearby से अब तक ट्रांसफर', 'Nearby 已传输', 'Ya transferido con Nearby'],
    ['файлов передано', 'files transferred', 'फ़ाइलें ट्रांसफर हुईं', '个文件已传输', 'archivos transferidos'],
    ['Точное число байтов', 'Exact byte count', 'बाइट की सटीक संख्या', '准确字节数', 'Número exacto de bytes'],
    ['данных · нажмите на объём', 'of data · click the volume', 'डेटा · मात्रा पर क्लिक करें', '数据 · 点击查看', 'de datos · pulsa el volumen'],
    ['Загружаем общий итог…', 'Loading totals…', 'कुल आँकड़े लोड हो रहे हैं…', '正在加载统计…', 'Cargando totales…'],
    ['Общий итог браузерной версии и приложения Windows. Содержимое и имена файлов в статистику не входят.', 'Totals include the web and Windows versions. File names and contents are not included in statistics.', 'वेब और Windows संस्करण के कुल आँकड़े। फ़ाइलों के नाम और सामग्री आँकड़ों में शामिल नहीं हैं।', '统计包括网页版和 Windows 版，不收集文件名或文件内容。', 'Totales de las versiones web y Windows. Los nombres y contenidos no se incluyen en las estadísticas.'],
    ['Два способа передачи', 'Two transfer modes', 'ट्रांसफर के दो तरीके', '两种传输方式', 'Dos modos de transferencia'],
    ['В одной сети файлы идут напрямую через WebRTC. В интернет-режиме сервер временно буферизует зашифрованные части. Содержимое и имена шифруются на устройствах; ключ находится только в ссылке-приглашении.', 'On the same network, WebRTC transfers files directly. Internet mode temporarily buffers encrypted chunks on the server. Names and contents are encrypted on the devices; the key is only in the invitation link.', 'एक नेटवर्क में WebRTC से फ़ाइलें सीधे जाती हैं। इंटरनेट मोड में सर्वर एन्क्रिप्टेड हिस्से अस्थायी रूप से रखता है। नाम और सामग्री डिवाइसों पर एन्क्रिप्ट होते हैं; कुंजी सिर्फ आमंत्रण लिंक में है।', '同一网络通过 WebRTC 直接传输，互联网模式由服务器临时缓冲加密分块。文件名和内容在设备上加密，密钥仅位于邀请链接。', 'En la misma red se usa WebRTC directamente. Por internet, el servidor almacena temporalmente fragmentos cifrados. Los nombres y contenidos se cifran en los dispositivos; la clave solo está en la invitación.'],
    ['Под вашим контролем', 'Under your control', 'आपके नियंत्रण में', '由您控制', 'Bajo tu control'],
    ['Вы подтверждаете второе устройство и каждый входящий файл. Для подключения к сайту нужен интернет. Для общего счётчика отправляем размер и ID завершённой передачи.', 'You confirm the other device and each incoming file. Opening the site requires internet. The counter receives the size and ID of completed transfers.', 'दूसरे डिवाइस और हर आने वाली फ़ाइल की पुष्टि आप करते हैं। साइट खोलने के लिए इंटरनेट चाहिए। कुल काउंटर को पूरी ट्रांसफर का आकार और ID भेजते हैं।', '由您确认另一台设备及每个传入文件。访问网站需要互联网，计数器仅接收已完成传输的大小和 ID。', 'Confirmas el otro dispositivo y cada archivo entrante. La web requiere internet. El contador recibe el tamaño y el ID de transferencias completadas.'],
    ['Держите вкладки открытыми', 'Keep the tabs open', 'टैब खुले रखें', '保持标签页打开', 'Mantén las pestañas abiertas'],
    ['Не блокируйте телефон во время передачи. Если устройства в разных сетях или прямое соединение недоступно, выберите «Через интернет».', 'Do not lock the phone during a transfer. Choose Internet when devices are on different networks or a direct connection is unavailable.', 'ट्रांसफर के दौरान फोन लॉक न करें। अलग नेटवर्क या सीधा संपर्क न हो तो इंटरनेट मोड चुनें।', '传输时请勿锁屏。设备处于不同网络或无法直接连接时，请选择互联网模式。', 'No bloquees el móvil durante la transferencia. Elige Internet si las redes son diferentes o no hay conexión directa.'],
    ['Как это работает ↗', 'How it works (Russian docs) ↗', 'यह कैसे काम करता है (रूसी दस्तावेज़) ↗', '工作原理（俄语文档）↗', 'Cómo funciona (documentación en ruso) ↗'],
    ['Скачать Windows-приложение ↗', 'Download Windows app ↗', 'Windows ऐप डाउनलोड करें ↗', '下载 Windows 应用 ↗', 'Descargar la aplicación Windows ↗'],
    ['Ожидаем подтверждения', 'Waiting for approval', 'पुष्टि की प्रतीक्षा है', '等待确认', 'Esperando confirmación'],
    ['Устанавливаем интернет-связь', 'Connecting over the internet', 'इंटरनेट कनेक्शन बन रहा है', '正在建立互联网连接', 'Conectando por internet'],
    ['Проверяем зашифрованное соединение с другим устройством.', 'Checking the encrypted connection to the other device.', 'दूसरे डिवाइस से एन्क्रिप्टेड संपर्क जाँच रहे हैं।', '正在检查与另一台设备的加密连接。', 'Comprobando la conexión cifrada con el otro dispositivo.'],
    ['Устанавливаем связь', 'Connecting', 'जुड़ रहे हैं', '正在连接', 'Conectando'],
    ['Разрешите доступ к локальной сети, если браузер попросит.', 'Allow local-network access if your browser asks.', 'ब्राउज़र पूछे तो लोकल नेटवर्क की अनुमति दें।', '浏览器询问时请允许访问局域网。', 'Permite el acceso a la red local si lo solicita el navegador.'],
    ['Связь прервалась', 'Connection interrupted', 'कनेक्शन टूट गया', '连接已中断', 'Conexión interrumpida'],
    ['Разрешить подключение?', 'Allow this connection?', 'कनेक्शन की अनुमति दें?', '允许此连接？', '¿Permitir la conexión?'],
    ['Убедитесь, что приглашение открыл ваш получатель.', 'Check that the expected recipient opened the invitation.', 'जाँचें कि आमंत्रण सही प्राप्तकर्ता ने खोला है।', '请确认打开邀请的是预期接收方。', 'Comprueba que la invitación la abrió el destinatario esperado.'],
    ['Проверяем соединение с сайтом…', 'Checking the website connection…', 'साइट का कनेक्शन जाँच रहे हैं…', '正在检查网站连接…', 'Comprobando la conexión con la web…'],
    ['Устройства соединены', 'Devices connected', 'डिवाइस जुड़ गए', '设备已连接', 'Dispositivos conectados'],
    ['Выберите файл здесь или на втором устройстве.', 'Choose a file here or on the other device.', 'यहाँ या दूसरे डिवाइस पर फ़ाइल चुनें।', '在此设备或另一台设备选择文件。', 'Elige un archivo aquí o en el otro dispositivo.'],
    ['Интернет · сквозное шифрование', 'Internet · end-to-end encryption', 'इंटरनेट · एंड-टू-एंड एन्क्रिप्शन', '互联网 · 端到端加密', 'Internet · cifrado de extremo a extremo'],
    ['WebRTC · напрямую', 'WebRTC · direct', 'WebRTC · सीधे', 'WebRTC · 直接传输', 'WebRTC · directo'],
    ['Прогресс передачи', 'Transfer progress', 'ट्रांसफर की प्रगति', '传输进度', 'Progreso de transferencia'],
    ['Принять файл с другого устройства?', 'Accept the file from the other device?', 'दूसरे डिवाइस की फ़ाइल स्वीकार करें?', '接收另一台设备的文件？', '¿Aceptar el archivo del otro dispositivo?'],
    ['Ожидаем подтверждения получателя…', 'Waiting for the recipient to accept…', 'प्राप्तकर्ता की पुष्टि की प्रतीक्षा है…', '等待接收方确认…', 'Esperando la aceptación del destinatario…'],
    ['Принять', 'Accept', 'स्वीकार करें', '接收', 'Aceptar'],
    ['Отклонить', 'Reject', 'अस्वीकार करें', '拒绝', 'Rechazar'],
    ['Отменить', 'Cancel', 'रद्द करें', '取消', 'Cancelar'],
    ['Передан получателю.', 'Transferred to the recipient.', 'प्राप्तकर्ता को भेज दिया।', '已传输给接收方。', 'Transferido al destinatario.'],
    ['Файл принят. Нажмите «Сохранить файл».', 'File received. Click Save file.', 'फ़ाइल मिल गई। सेव बटन दबाएँ।', '文件已接收，请点击保存文件。', 'Archivo recibido. Pulsa Guardar archivo.'],
    ['Сохранён в выбранный файл.', 'Saved to the selected file.', 'चुनी हुई फ़ाइल में सेव हुआ।', '已保存到选定文件。', 'Guardado en el archivo seleccionado.'],
    ['Сохранить файл ↓', 'Save file ↓', 'फ़ाइल सेव करें ↓', '保存文件 ↓', 'Guardar archivo ↓'],
    ['Убрать из памяти', 'Remove from memory', 'मेमोरी से हटाएँ', '从内存移除', 'Quitar de la memoria'],
    ['Файл удалён из памяти вкладки.', 'File removed from this tab’s memory.', 'फ़ाइल इस टैब की मेमोरी से हटा दी गई।', '文件已从此标签页内存移除。', 'Archivo eliminado de la memoria de esta pestaña.'],
    ['Файл отклонён.', 'File rejected.', 'फ़ाइल अस्वीकार की गई।', '文件已被拒绝。', 'Archivo rechazado.'],
    ['Сохранение отменено.', 'Saving cancelled.', 'सेव करना रद्द हुआ।', '保存已取消。', 'Guardado cancelado.'],
    ['Соединение завершено', 'Connection ended', 'कनेक्शन समाप्त', '连接已结束', 'Conexión finalizada'],
    ['Нажмите «Новое подключение», чтобы попробовать снова.', 'Choose New connection to try again.', 'दोबारा कोशिश के लिए नया कनेक्शन चुनें।', '选择新建连接以重试。', 'Pulsa Nueva conexión para intentarlo otra vez.'],
    ['Не подключено', 'Not connected', 'कनेक्ट नहीं है', '未连接', 'Sin conexión'],
    ['Новое подключение', 'New connection', 'नया कनेक्शन', '新建连接', 'Nueva conexión'],
    ['Ссылка скопирована ✓', 'Link copied ✓', 'लिंक कॉपी हुआ ✓', '链接已复制 ✓', 'Enlace copiado ✓'],
    ['Скопируйте выделенную ссылку.', 'Copy the selected link.', 'चुना हुआ लिंक कॉपी करें।', '复制选中的链接。', 'Copia el enlace seleccionado.'],
    ['Вас пригласили в Nearby', 'You have a Nearby invitation', 'आपको Nearby का आमंत्रण मिला है', '您收到 Nearby 邀请', 'Tienes una invitación de Nearby'],
    ['Подключение отклонено.', 'Connection rejected.', 'कनेक्शन अस्वीकार हुआ।', '连接已被拒绝。', 'Conexión rechazada.'],
    ['Соединение завершено. Принятые файлы можно сохранить ниже.', 'Connection ended. You can save received files below.', 'कनेक्शन समाप्त हुआ। मिली फ़ाइलें नीचे सेव कर सकते हैं।', '连接已结束，可在下方保存已接收文件。', 'Conexión finalizada. Puedes guardar los archivos recibidos más abajo.'],
    ['Для устройств в одной доступной локальной сети. Файлы идут напрямую через WebRTC.', 'For devices on an accessible shared network. Files transfer directly through WebRTC.', 'एक उपलब्ध साझा नेटवर्क के लिए। WebRTC से फ़ाइलें सीधे जाती हैं।', '适用于可互通的共享网络，文件通过 WebRTC 直接传输。', 'Para dispositivos en una red compartida accesible. Los archivos van directamente por WebRTC.'],
    ['Для разных Wi-Fi и мобильного интернета. До 100 МиБ на файл; оба устройства остаются онлайн. Зашифрованные части временно проходят через сервер.', 'For different Wi-Fi networks and mobile data. Up to 100 MiB per file; both devices stay online. The server temporarily relays encrypted chunks.', 'अलग Wi-Fi और मोबाइल डेटा के लिए। हर फ़ाइल 100 MiB तक; दोनों डिवाइस ऑनलाइन रखें। सर्वर अस्थायी एन्क्रिप्टेड हिस्से आगे भेजता है।', '适用于不同 Wi-Fi 或移动数据，单个文件上限 100 MiB，两台设备保持在线。服务器临时转发加密分块。', 'Para distintas redes Wi-Fi y datos móviles. Hasta 100 MiB por archivo; ambos dispositivos en línea. El servidor retransmite fragmentos cifrados temporalmente.'],
    ['При приёме выберите, куда сохранить файл. Запись идёт частями, без загрузки всего файла в память.', 'Choose a destination when receiving. Data is written in chunks without buffering the whole file in memory.', 'प्राप्त करते समय जगह चुनें। पूरी फ़ाइल मेमोरी में रखे बिना हिस्सों में लिखी जाती है।', '接收时选择保存位置，数据分块写入，无需将整个文件载入内存。', 'Elige el destino al recibir. Se escribe por partes sin cargar todo el archivo en memoria.'],
    ['В этом браузере: до 100 МиБ на файл. После приёма нажмите «Сохранить файл». Сохраняйте файлы перед закрытием вкладки.', 'This browser: up to 100 MiB per file. After receiving, click Save file. Save files before closing the tab.', 'इस ब्राउज़र में हर फ़ाइल 100 MiB तक। प्राप्त होने पर सेव बटन दबाएँ। टैब बंद करने से पहले सेव करें।', '此浏览器单个文件上限 100 MiB，接收后请点击保存文件，并在关闭标签页前完成保存。', 'En este navegador: hasta 100 MiB por archivo. Tras recibir, pulsa Guardar archivo antes de cerrar la pestaña.'],
    ['Браузерная версия и Windows · обновление раз в минуту', 'Web and Windows versions · updated every minute', 'वेब और Windows · हर मिनट अपडेट', '网页版和 Windows 版 · 每分钟更新', 'Versiones web y Windows · actualización cada minuto'],
    ['Общая статистика временно недоступна. Передавать файлы по локальной сети можно без неё.', 'Statistics are temporarily unavailable. Local file transfers can still work.', 'आँकड़े अभी उपलब्ध नहीं हैं। लोकल फ़ाइल ट्रांसफर इनके बिना भी हो सकता है।', '统计暂不可用，本地文件传输仍可使用。', 'Estadísticas temporalmente no disponibles. La transferencia local puede funcionar sin ellas.'],
    ['Нужна ссылка-приглашение Nearby с этого сайта.', 'Use a Nearby invitation from this website.', 'इसी साइट का Nearby आमंत्रण इस्तेमाल करें।', '请使用此网站的 Nearby 邀请。', 'Usa una invitación de Nearby de este sitio.'],
    ['Ссылка-приглашение неполная. Скопируйте её целиком.', 'The invitation is incomplete. Copy the entire link.', 'आमंत्रण अधूरा है। पूरा लिंक कॉपी करें।', '邀请不完整，请复制完整链接。', 'La invitación está incompleta. Copia el enlace entero.'],
    ['Нужна полная ссылка с ключом интернет-передачи. Скопируйте приглашение заново.', 'A complete link with the internet transfer key is required. Copy the invitation again.', 'इंटरनेट ट्रांसफर की कुंजी सहित पूरा लिंक चाहिए। आमंत्रण फिर कॉपी करें।', '需要包含互联网传输密钥的完整链接，请重新复制邀请。', 'Hace falta el enlace completo con la clave. Vuelve a copiar la invitación.'],
    ['Сервер вернул неожиданный ответ. Попробуйте позже.', 'Unexpected server response. Try again later.', 'सर्वर से अप्रत्याशित उत्तर मिला। बाद में कोशिश करें।', '服务器响应异常，请稍后重试。', 'Respuesta inesperada del servidor. Inténtalo más tarde.'],
    ['Ошибка соединения.', 'Connection error.', 'कनेक्शन में त्रुटि।', '连接错误。', 'Error de conexión.'],
    ['Приглашение не найдено или истекло.', 'Invitation not found or expired.', 'आमंत्रण नहीं मिला या समाप्त हो गया।', '邀请不存在或已过期。', 'Invitación no encontrada o caducada.'],
    ['Комната закрыта или время подключения истекло.', 'The session ended or expired.', 'सत्र बंद या समाप्त हो गया।', '会话已关闭或过期。', 'La sesión se cerró o caducó.'],
    ['Приглашение уже использовано. Создайте новое.', 'Invitation already used. Create a new one.', 'आमंत्रण इस्तेमाल हो चुका है। नया बनाएँ।', '邀请已使用，请创建新邀请。', 'Invitación ya utilizada. Crea otra.'],
    ['Недействительное приглашение.', 'Invalid invitation.', 'अमान्य आमंत्रण।', '邀请无效。', 'Invitación no válida.'],
    ['Сначала подтвердите устройство.', 'Confirm the device first.', 'पहले डिवाइस की पुष्टि करें।', '请先确认设备。', 'Confirma primero el dispositivo.'],
    ['Слишком много запросов. Подождите минуту.', 'Too many requests. Wait a minute.', 'बहुत अधिक अनुरोध। एक मिनट रुकें।', '请求过多，请等待一分钟。', 'Demasiadas solicitudes. Espera un minuto.'],
    ['Сервис занят. Попробуйте позже.', 'The service is busy. Try later.', 'सेवा व्यस्त है। बाद में कोशिश करें।', '服务繁忙，请稍后重试。', 'El servicio está ocupado. Inténtalo más tarde.'],
    ['Интернет-режим сейчас занят. Попробуйте позже.', 'Internet mode is busy. Try later.', 'इंटरनेट मोड व्यस्त है। बाद में कोशिश करें।', '互联网模式繁忙，请稍后重试。', 'El modo por internet está ocupado. Inténtalo más tarde.'],
    ['QR-код не удалось создать. Используйте ссылку-приглашение.', 'Could not create a QR code. Use the invitation link.', 'QR नहीं बना। आमंत्रण लिंक इस्तेमाल करें।', '无法生成二维码，请使用邀请链接。', 'No se pudo crear el QR. Usa el enlace de invitación.'],
  ];
  const errors = [
    [['Режим приглашения изменён. Попросите новую полную ссылку.','В приглашении отсутствует ключ интернет-передачи. Создайте новую ссылку.','Не удалось проверить шифрование. Создайте новое приглашение и передайте ссылку целиком.'], ['Create a new invitation and share its complete link, including the encryption key.', 'नया आमंत्रण बनाएँ और एन्क्रिप्शन कुंजी सहित पूरा लिंक साझा करें।', '请创建新邀请，并分享包含加密密钥的完整链接。', 'Crea otra invitación y comparte el enlace completo con la clave de cifrado.']],
    [['Интернет-связь не установлена. Проверьте доступ к сайту и передайте приглашение целиком.','Интернет-передача прервана.','Интернет-соединение закрыто.','Соединение с другим устройством закрыто. Создайте новое подключение.','Соединение закрыто.','Нет соединения с устройством.'], ['Connection closed or unavailable. Check access and create a new connection.', 'कनेक्शन बंद या उपलब्ध नहीं है। पहुँच जाँचकर नया कनेक्शन बनाएँ।', '连接已关闭或不可用，请检查网络并新建连接。', 'Conexión cerrada o no disponible. Comprueba el acceso y crea otra conexión.']],
    [['Локальный WebRTC недоступен в этом браузере. Выберите режим «Через интернет».'], ['Local WebRTC is unavailable. Choose Internet mode.', 'लोकल WebRTC उपलब्ध नहीं है। इंटरनेट मोड चुनें।', '此浏览器无法使用本地 WebRTC，请选择互联网模式。', 'WebRTC local no está disponible. Elige el modo por internet.']],
    [['Прямое соединение не удалось. Проверьте общую локальную сеть, отключите VPN или используйте Windows-приложение.','Устройства не смогли соединиться напрямую. Подключите их к одной обычной сети Wi-Fi; гостевая сеть может изолировать устройства.'], ['Direct connection failed. Check the shared network and VPN, or try Internet mode.', 'सीधा कनेक्शन नहीं बना। साझा नेटवर्क और VPN जाँचें या इंटरनेट मोड आजमाएँ।', '直接连接失败，请检查共享网络和 VPN，或尝试互联网模式。', 'Falló la conexión directa. Revisa la red y la VPN o prueba el modo por internet.']],
    [['Передача может быть прервана. Если связь не восстановится, создайте новое подключение.','Устройство не ответило вовремя.','Передача прервана: устройство не отвечает.'], ['The device is not responding. If the connection does not recover, create a new one.', 'डिवाइस जवाब नहीं दे रहा। संपर्क वापस न आए तो नया कनेक्शन बनाएँ।', '设备没有响应，连接无法恢复时请新建连接。', 'El dispositivo no responde. Si no se recupera, crea otra conexión.']],
    [['Для обычного скачивания доступны файлы до 100 МиБ. Для больших файлов используйте Chrome/Edge на ПК с разрешённой записью на диск.'], ['Standard downloads support up to 100 MiB. Larger local files require a supported browser and disk writing.', 'सामान्य डाउनलोड 100 MiB तक है। बड़ी लोकल फ़ाइल के लिए समर्थित ब्राउज़र और डिस्क लेखन चाहिए।', '普通下载上限为 100 MiB，更大的本地文件需要支持磁盘写入的浏览器。', 'La descarga normal admite hasta 100 MiB. Para archivos locales mayores hace falta un navegador con escritura en disco.']],
    [['Сначала сохраните принятые файлы и нажмите «Убрать из памяти». Вкладка хранит не более 100 МиБ.'], ['Save received files and remove them from memory first. This tab holds up to 100 MiB.', 'पहले प्राप्त फ़ाइलें सेव करके मेमोरी से हटाएँ। टैब में 100 MiB तक रहता है।', '请先保存已接收文件并从内存移除，标签页最多保留 100 MiB。', 'Guarda los archivos recibidos y quítalos de memoria. La pestaña admite hasta 100 MiB.']],
    [['Браузер не разрешил запись в выбранный файл. После приёма нажмите «Сохранить файл».'], ['The browser denied disk writing. Click Save file after receiving.', 'ब्राउज़र ने डिस्क लेखन नहीं दिया। प्राप्त होने पर सेव बटन दबाएँ।', '浏览器未允许磁盘写入，接收后请点击保存文件。', 'El navegador no permitió escribir en disco. Pulsa Guardar archivo después de recibir.']],
    [['Откройте Nearby по HTTPS в современном браузере. На Windows рекомендуем Chrome или Edge.'], ['Open Nearby over HTTPS in a supported modern browser.', 'Nearby को HTTPS पर आधुनिक समर्थित ब्राउज़र में खोलें।', '请通过 HTTPS 在支持的现代浏览器中打开 Nearby。', 'Abre Nearby por HTTPS en un navegador moderno compatible.']],
    [['Дождитесь завершения текущей отправки.'], ['Wait for the current transfer to finish.', 'वर्तमान ट्रांसफर पूरी होने दें।', '请等待当前传输完成。', 'Espera a que termine la transferencia actual.']],
    [['Устройство ещё не готово.','Получатель не успевает принимать данные.'], ['The recipient is not ready. Wait and try again.', 'प्राप्तकर्ता तैयार नहीं है। रुककर दोबारा कोशिश करें।', '接收方尚未准备好，请等待后重试。', 'El destinatario no está listo. Espera e inténtalo otra vez.']],
    [['Передача отменена.','Передача отклонена или отменена другим устройством.','Файл не был принят.'], ['The transfer was cancelled or rejected.', 'ट्रांसफर रद्द या अस्वीकार हुआ।', '传输已取消或被拒绝。', 'Transferencia cancelada o rechazada.']],
    [['Запрос уже недоступен.','Время подтверждения истекло.'], ['The request expired or is no longer available. Try again.', 'अनुरोध समाप्त या उपलब्ध नहीं है। दोबारा कोशिश करें।', '请求已过期或不可用，请重试。', 'La solicitud caducó o ya no está disponible. Inténtalo otra vez.']],
    [['Несовместимая версия Nearby.','Несовместимый размер частей Nearby.'], ['The Nearby versions are incompatible. Update both devices.', 'Nearby संस्करण अनुकूल नहीं हैं। दोनों डिवाइस अपडेट करें।', 'Nearby 版本不兼容，请更新两台设备。', 'Las versiones de Nearby no son compatibles. Actualiza ambos dispositivos.']],
    [['Недопустимое имя или размер файла.','Некорректный идентификатор файла.'], ['The file name, size or identifier is invalid.', 'फ़ाइल का नाम, आकार या ID अमान्य है।', '文件名、大小或标识无效。', 'El nombre, tamaño o identificador del archivo no es válido.']],
    [['Неожиданное описание соединения.','Ошибка передачи данных.','Ошибка подтверждения части файла.','Неожиданная часть файла.','Контрольная сумма части файла не совпала.','Слишком большое управляющее сообщение.','Некорректное сообщение.','Повреждённая последовательность частей файла.','Файл получен не полностью.','Неизвестное сообщение.','Некорректная зашифрованная часть.','Нарушен порядок интернет-передачи.','Слишком большая часть интернет-передачи.','Некорректный тип интернет-передачи.','Некорректное подтверждение интернет-передачи.','Некорректный ответ интернет-передачи.'], ['Transfer validation failed. Create a new connection and resend the file.', 'ट्रांसफर की जाँच असफल हुई। नया कनेक्शन बनाकर फ़ाइल फिर भेजें।', '传输验证失败，请新建连接并重新发送文件。', 'Falló la validación de la transferencia. Crea otra conexión y vuelve a enviar el archivo.']],
  ];
  for (const [sources, translations] of errors) for (const source of sources) rows.push([source, ...translations]);
  const catalogue = new Map(rows.map(([source, ...translations]) => [source, translations]));
  const names = [['ru','Русский'],['en','English'],['hi','हिन्दी'],['zh-CN','简体中文'],['es','Español']];
  const query = new URLSearchParams(location.search).get('lang');
  let remembered; try { remembered = localStorage.getItem('nearby-site-language'); } catch {}
  let browserLanguage = (navigator.languages || [navigator.language]).map(value => value.toLowerCase().split('-')[0]).find(value => ['ru','en','hi','zh','es'].includes(value));
  if (browserLanguage === 'zh') browserLanguage = 'zh-CN';
  let language = supported.includes(query) ? query : supported.includes(remembered) ? remembered : browserLanguage || 'en';
  const records = new WeakMap();
  const protectedSelector = '.transfer-title,#peer-name,#connection-id span,input,textarea,script,style,code,.web-language';
  function translate(source) {
    if (language === 'ru') return source;
    const index = languages.indexOf(language), value = source.replace(/\s+/g, ' ').trim();
    const entry = catalogue.get(value);
    if (entry) return source.replace(source.trim(), entry[index]);
    const folder = value.match(/^Папка: (.+)$/);
    if (folder) return ['Folder: ', 'फ़ोल्डर: ', '文件夹：', 'Carpeta: '][index] + folder[1];
    const connected = value.match(/^Подключено: (.+)\. Файлы принимаются автоматически\.$/);
    if (connected) return ['Connected: {name}. Files are received automatically.', 'कनेक्ट किया: {name}। फ़ाइलें अपने आप मिलती हैं।', '已连接：{name}。自动接收文件。', 'Conectado: {name}. Recepción automática de archivos.'][index].replace('{name}', connected[1]);
    const suffix = ': подтвердите подключение на первом устройстве.';
    if (value.endsWith(suffix)) return value.slice(0, -suffix.length) + [': confirm the connection on the first device.', ': पहले डिवाइस पर कनेक्शन की पुष्टि करें।', '：请在第一台设备确认连接。', ': confirma la conexión en el primer dispositivo.'][index];
    const limit = value.match(/^До (.+) на файл для этого получателя$/);
    if (limit) return ['Up to {size} per file for this recipient', 'इस प्राप्तकर्ता के लिए हर फ़ाइल {size} तक', '此接收方单个文件上限 {size}', 'Hasta {size} por archivo para este destinatario'][index].replace('{size}', units(limit[1]));
    let result = value;
    for (const [ru, target] of [
      ['↓ Входящий', ['↓ Incoming','↓ आने वाली','↓ 传入','↓ Entrante']], ['↑ Исходящий', ['↑ Outgoing','↑ जाने वाली','↑ 传出','↑ Saliente']],
      ['Отправляем:', ['Sending:','भेज रहे हैं:','正在发送：','Enviando:']], ['Принимаем:', ['Receiving:','प्राप्त हो रहा है:','正在接收：','Recibiendo:']],
    ]) if (result.startsWith(ru)) result = target[index] + result.slice(ru.length);
    if (/^(?:\d|Передано )/.test(result)) result = result.replace(/^Передано /, ['Transferred ','ट्रांसफर ','已传输 ','Transferido '][index]).replace(/Точное число байтов/g, ['Exact byte count','बाइट की सटीक संख्या','准确字节数','Número exacto de bytes'][index]).replace(/байт/g, 'B');
    return units(result);
  }
  function units(value) { return value.replace(/КиБ/g,'KiB').replace(/МиБ/g,'MiB').replace(/ГиБ/g,'GiB').replace(/КБ/g,'KB').replace(/МБ/g,'MB').replace(/ГБ/g,'GB').replace(/ТБ/g,'TB').replace(/(\d) Б(?=$|[\s·/])/g,'$1 B'); }
  function updateText(node) {
    if (!node.parentElement || node.parentElement.closest(protectedSelector)) return;
    const current = node.nodeValue, saved = records.get(node);
    const source = saved && saved.output === current ? saved.source : current;
    const output = translate(source);
    records.set(node, { source, output });
    if (output !== current) node.nodeValue = output;
  }
  function updateElement(element) {
    if (element.closest?.(protectedSelector) && !element.matches('input')) return;
    for (const attr of ['placeholder','aria-label','alt']) if (element.hasAttribute?.(attr)) {
      const name = '@' + attr, record = records.get(element) || {}, current = element.getAttribute(attr), saved = record[name];
      const source = saved && saved.output === current ? saved.source : current;
      const output = translate(source); record[name] = { source, output }; records.set(element, record);
      if (current !== output) element.setAttribute(attr, output);
    }
  }
  function walk(root) {
    if (root.nodeType === Node.TEXT_NODE) { updateText(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || root.closest(protectedSelector)) return;
    updateElement(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) { const node = walker.currentNode; if (node.nodeType === Node.TEXT_NODE) updateText(node); else updateElement(node); }
  }
  const wrapper = document.createElement('div'); wrapper.className = 'web-language';
  const label = document.createElement('label'); label.htmlFor = 'web-language-choice';
  const select = document.createElement('select'); select.id = 'web-language-choice';
  for (const [value,text] of names) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
  wrapper.append(label,select); document.querySelector('header').append(wrapper);
  function apply() {
    document.documentElement.lang = language; select.value = language;
    label.textContent = {ru:'Язык',en:'Language',hi:'भाषा','zh-CN':'语言',es:'Idioma'}[language];
    document.title = language === 'ru' ? 'Nearby — передача в браузере' : catalogue.get('Nearby — передача в браузере')[languages.indexOf(language)];
    walk(document.body);
  }
  select.addEventListener('change', () => {
    language = select.value;
    try { localStorage.setItem('nearby-site-language', language); } catch {}
    document.cookie = `nearby-site-language=${language}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    apply();
  });
  const observer = new MutationObserver(changes => {
    for (const change of changes) {
      if (change.type === 'characterData') updateText(change.target);
      else if (change.type === 'attributes') updateElement(change.target);
      else for (const node of change.addedNodes) walk(node);
    }
  });
  apply(); observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['placeholder','aria-label','alt'] });
})();
