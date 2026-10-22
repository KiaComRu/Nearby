import { Connection } from '../browser/connection.mjs';
import { MEMORY_LIMIT } from '../browser/transfer.mjs';
import { newRelaySecret } from '../browser/relay.mjs';
import { normalizeInvitationId,formatInvitationId,shortInvitationLookup,invitationKeyExchange,sharedInvitationSecret,invitationCredentials } from '../browser/invitation-id.mjs';
import QRCode from 'qrcode/lib/browser.js';

const web = 'https://nearby.kiacom.ru/web/';
export class Client {
  constructor(options) { this.options=options;this.connections=new Map();this.pending=null;this.working=false;this.closed=false; }
  emit(name,...args) { return this.options[name]?.(...args); }
  changed() { this.emit('onChange'); }
  busy() { return [...this.connections.values()].some(connection=>connection.link?.incoming || connection.link?.outgoing); }
  targets() { return [...this.connections.values()].filter(connection=>connection.hasConnected&&!connection.stopped).map(connection=>({id:'internet:'+connection.id,kind:'internet',name:connection.peerName||'Интернет-устройство',secure:true,ready:connection.ready,maxSize:Math.min(MEMORY_LIMIT,connection.link?.peerLimit||MEMORY_LIMIT)})); }
  connection(target) { return this.connections.get(target.id.replace(/^internet:/,'')); }
  async request(action,extra={},session=null) { return this.options.request(action,extra,session); }
  register(session,peerName='') {
    const manager=this;
    class NativeConnection extends Connection {
      api(action,extra={}) { return manager.request(action,extra,this.session); }
      async reportStatistics(action,extra={}) {
        for(const delay of [0,1500,5000]) {
          if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
          try { await this.api(action,extra);document.dispatchEvent(new Event(action==='record-usage'?'nearby-connection-complete':'nearby-transfer-complete'));return; }
          catch(error) { if(error.status<500&&error.status!==429)return; }
        }
      }
    }
    const connection=new NativeConnection(session,{
      receiveLimit:()=>MEMORY_LIMIT,
      onStatus:(connection,title,detail)=>{this.emit('onStatus',connection,title,detail);this.changed();},
      onNotice:(connection,text)=>this.emit('onNotice',text),
      onPeerRequest:(connection,name)=>this.emit('onPeerRequest',connection,name),
      onApproved:connection=>this.emit('onApproved',connection),
      onReady:connection=>{if(this.pending===connection)this.pending=null;this.emit('onReady',connection);this.changed();},
      onOffer:(connection,spec,link)=>this.emit('onOffer',connection,spec,link),
      onProgress:(connection,...args)=>this.emit('onProgress',connection,...args),
      onComplete:(connection,...args)=>this.emit('onComplete',connection,...args),
      onError:(connection,...args)=>this.emit('onError',connection,...args),
      onClosed:(connection,text,expected)=>{if(this.pending===connection)this.pending=null;this.connections.delete(connection.id);this.emit('onClosed',connection,text,expected);this.changed();}
    });
    connection.peerName=peerName;this.connections.set(connection.id,connection);this.pending=connection;return connection;
  }
  async create(name) {
    if(this.working||this.pending||this.closed)throw new Error('Сначала завершите текущее приглашение.');
    if(this.connections.size>=8)throw new Error('Подключено слишком много устройств.');
    this.working=true;this.changed();
    try {
      const exchange=await invitationKeyExchange();
      const result=await this.request('create',{name,mode:'internet',shortId:true,idPublicKey:exchange.publicKey});
      const session={room:result.room,token:result.token,role:'host',mode:'internet',relaySecret:newRelaySecret(),idPrivateKey:exchange.privateKey};
      if(this.closed){void this.request('close',{},session);return null;}
      if(result.mode!=='internet'||result.shortId!==true||!/^\d{9}$/.test(result.id||''))throw new Error('Интернет-сервер Nearby нужно обновить.');
      const connection=this.register(session),url=new URL(web);url.hash=new URLSearchParams({room:result.room,key:result.invite,mode:'internet',secret:session.relaySecret}).toString();
      this.emit('onInvitation',connection,{id:formatInvitationId(result.id),url:url.href,expires:result.inviteExpires});
      connection.start();return connection;
    } finally {this.working=false;this.changed();}
  }
  async join(value,name) {
    if(this.working||this.pending||this.closed)throw new Error('Сначала завершите текущее приглашение.');
    if(this.connections.size>=8)throw new Error('Подключено слишком много устройств.');
    this.working=true;this.changed();
    try {
      let invite;
      if(/^[\da-z\s-]+$/i.test(value.trim())) {
        const code=normalizeInvitationId(value);
        if(code.length===9){
          const result=await this.request('resolve-id',{lookup:await shortInvitationLookup(code)}),exchange=await invitationKeyExchange();
          invite={room:result.room,token:result.token,mode:result.mode,idPublicKey:exchange.publicKey,relaySecret:await sharedInvitationSecret(exchange.privateKey,result.idPublicKey,result.room)};
        } else {
          const credentials=await invitationCredentials(code),result=await this.request('resolve-id',{lookup:credentials.lookup});invite={room:result.room,token:credentials.token,mode:result.mode,relaySecret:credentials.relaySecret};
        }
      } else {
        const url=new URL(value);
        if(url.origin!==new URL(web).origin||url.pathname!=='/web/'||url.username||url.password)throw new Error('Нужна ссылка-приглашение Nearby.');
        const params=new URLSearchParams(url.hash.slice(1));invite={room:params.get('room'),token:params.get('key'),mode:params.get('mode'),relaySecret:params.get('secret')};
        if(!/^[a-f0-9]{32}$/.test(invite.room||'')||!/^[a-f0-9]{64}$/.test(invite.token||'')||!/^[a-f0-9]{64}$/.test(invite.relaySecret||''))throw new Error('Ссылка-приглашение неполная.');
      }
      if(!['internet','auto'].includes(invite.mode))throw new Error('Это локальное веб-приглашение. Создайте приглашение для интернета.');
      if(this.connections.has(invite.room))throw new Error('Это устройство уже подключено.');
      const result=await this.request('join',{room:invite.room,token:invite.token,name,...(invite.idPublicKey?{idPublicKey:invite.idPublicKey}:{})});
      const session={room:invite.room,token:result.token,role:'guest',mode:invite.mode,relaySecret:invite.relaySecret};
      if(this.closed){void this.request('close',{},session);return null;}
      if((result.mode||'lan')!==invite.mode)throw new Error('Режим приглашения изменился. Попросите новую ссылку.');
      const connection=this.register(session,result.hostName);connection.start();return connection;
    } finally {this.working=false;this.changed();}
  }
  async send(target,file,id,{signal,onProgress}={}) {
    const connection=this.connection(target),link=connection?.link;
    if(!connection?.ready||connection.stopped||!link)throw new Error('Интернет-устройство отключилось. Выберите получателя ещё раз.');
    if(signal?.aborted)throw new DOMException('Отправка остановлена','AbortError');
    const abort=()=>link.cancel(id,'Отправка остановлена.');signal?.addEventListener('abort',abort,{once:true});
    const previous=connection.extraProgress;connection.extraProgress={id,onProgress};
    try {return await link.sendFile(file,id);}finally{signal?.removeEventListener('abort',abort);if(connection.extraProgress?.id===id)connection.extraProgress=previous;}
  }
  async approve() {if(this.pending)await this.pending.api('approve');}
  async disconnect(target) {const connection=target?this.connection(target):this.pending;if(connection)await connection.disconnect();}
  close() {this.closed=true;for(const connection of [...this.connections.values()]){void connection.api('close').catch(()=>{});connection.stop('Nearby закрыт.',true);}}
}
export const drawQR=(canvas,value)=>QRCode.toCanvas(canvas,value,{width:170,margin:1,errorCorrectionLevel:'M'});
