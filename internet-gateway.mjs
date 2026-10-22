export const INTERNET_LIMIT = 100 * 1024 ** 2;
export const INTERNET_API = 'https://nearby.kiacom.ru/web/api.php';
const actions = new Set(['create','resolve-id','join','poll','approve','close','signal','transport','relay-push','relay-pull','record-usage','record-transfer']);
const fail = (status,message) => Object.assign(new Error(message),{status});

// The browser talks only to its loopback engine. Never accept a destination URL
// or forward the loopback owner's Authorization header to the internet.
export function createInternetGateway(endpoint = INTERNET_API) {
  const base = new URL(endpoint);
  if (base.username || base.password || base.hash || base.search || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(base.hostname)))) throw new Error('Invalid internet API endpoint');
  let inFlight = 0;
  return async body => {
    if (!body || typeof body !== 'object' || !actions.has(body.action)) throw fail(400,'Неизвестное действие интернет-подключения.');
    if (inFlight >= 48) throw fail(429,'Слишком много интернет-запросов. Повторите позже.');
    const url = new URL(base); if (body.action.startsWith('relay-')) url.search = '?transport=relay';
    inFlight++;
    try {
      const response = await fetch(url,{method:'POST',redirect:'error',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
      const chunks = []; let length = 0;
      for await (const chunk of response.body) { length += chunk.length; if (length > 2*1024**2) throw fail(502,'Слишком большой ответ интернет-сервера.'); chunks.push(chunk); }
      let result; try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw fail(502,'Интернет-сервер вернул неожиданный ответ.'); }
      if (!response.ok || result.error) throw fail(response.status >= 400 ? response.status : 502,typeof result.error === 'string' ? result.error : 'Ошибка интернет-соединения.');
      return result;
    } catch(error) { if (error.status) throw error; throw fail(502,'Не удалось связаться с интернет-сервером Nearby. Проверьте доступ к интернету.'); }
    finally { inFlight--; }
  };
}
