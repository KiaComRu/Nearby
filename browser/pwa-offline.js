(() => {
  let language; try { language = localStorage.getItem('nearby-site-language'); } catch {}
  const codes = ['ru', 'en', 'hi', 'zh-CN', 'es'];
  if (!codes.includes(language)) { language = navigator.language.split('-')[0]; if (language === 'zh') language = 'zh-CN'; }
  const preferred = codes.indexOf(language), index = preferred < 0 ? 1 : preferred; document.documentElement.lang = codes[index];
  const text = {
    title: ['Сейчас нет связи', 'You are offline', 'अभी कनेक्शन नहीं है', '当前没有网络连接', 'Sin conexión'],
    description: ['Подключитесь к интернету и откройте Nearby снова. Для нового подключения нужен доступ к серверу.', 'Connect to the internet and reopen Nearby. A new connection requires access to the server.', 'इंटरनेट से जुड़कर Nearby फिर खोलें। नए कनेक्शन के लिए सर्वर तक पहुँच चाहिए।', '请连接互联网并重新打开 Nearby，新建连接需要访问服务器。', 'Conéctate a internet y vuelve a abrir Nearby. Una conexión nueva necesita acceso al servidor.'],
    retry: ['Попробовать снова', 'Try again', 'फिर कोशिश करें', '重试', 'Reintentar'],
    note: ['После прерванной передачи создайте новое подключение и отправьте файл заново.', 'After an interrupted transfer, create a new connection and send the file again.', 'ट्रांसफर रुकने के बाद नया कनेक्शन बनाकर फ़ाइल फिर भेजें।', '传输中断后，请新建连接并重新发送文件。', 'Tras una transferencia interrumpida, crea otra conexión y envía el archivo de nuevo.'],
  };
  for (const node of document.querySelectorAll('[data-offline]')) node.textContent = text[node.dataset.offline][index];
})();
