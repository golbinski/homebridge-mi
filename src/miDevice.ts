import dgram from 'dgram';
import crypto from 'crypto';
import { Logger } from 'homebridge';

export type RequestCallback = (error?: Error | null, value?: any) => void

type ResolveHandle = (value?: MiTransaction | PromiseLike<MiTransaction>) => void 
class MiTransaction {
  private next : MiTransaction | null = null;

  constructor(
    private readonly socket : MiSocket,
    private readonly notifier : ResolveHandle | null = null
  ) {
  }

  request(buf: Buffer) {
    return this.socket.send(buf)
      .then((response) => {
        this.socket.done(this);
        return response;
      })
      .catch((error) => {
        this.socket.done(this);
        throw error;
      });
  }

  enqueue(transaction: MiTransaction) {
    if (this.next === null) {
      this.next = transaction;
    } else {
      this.next.enqueue(transaction);
    }
  }

  notify() {
    if (this.notifier !== null) {
      this.notifier(this);
    }
  }

  close() {
    if (this.next !== null) {
      const nextTransaction = this.next as MiTransaction;
      nextTransaction.notify();
    }
    return this.next;
  }
}  // class MiTransaction

// TODO: extract header encoding/decoding to separate class
class MiSocket {
  private socket : dgram.Socket;
  private deviceId : number = 0;
  private lastStamp : number = 0;
  private transaction : MiTransaction | null = null;

  constructor(
      private readonly address: string,
      private readonly port: number,
      private readonly token: Buffer
  ) {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg, rinfo) => {
      const m = this.dump(msg);
      this.deviceId = m.header.device_id;
      if (m.header.stamp > this.lastStamp) {
        this.lastStamp = m.header.stamp;
      }
      this.socket.emit('debug', '<- ' + JSON.stringify(m));
    });
    this.socket.on('sent', (msg) => {
      const m = this.dump(msg);
      this.socket.emit('debug', '-> ' + JSON.stringify(m));
    });
  }

  private dump(msg: Buffer) {
    const header = {
      length: msg.readUInt16BE(2),
      device_id: msg.readUInt32BE(8),
      stamp: msg.readUInt32BE(12),
      checksum: msg.slice(16, 32).toString('hex')
    }
    const m = {
      header: header,
      payload: header.length === 32 ? '<handshake>' : '<encrypted>'
    }
    return m;
  }

  on(event, callback) {
    this.socket.on(event, callback);
  }

  name() {
    return this.address + '@' + this.port.toString();
  }

  executeTransaction() {
    if (this.transaction !== null) {
      return new Promise<MiTransaction>((resolve, reject) => {
        const currentTransaction = this.transaction as MiTransaction;
        const nextTransaction = new MiTransaction(this, resolve);
        currentTransaction.enqueue(nextTransaction);
      });
    }
    let newTransaction = new MiTransaction(this);
    this.transaction = newTransaction;
    return new Promise<MiTransaction>((resolve, reject) => {
      if (this.lastStamp === 0) {
        const timeout = setTimeout(() => { reject('timeout'); }, 10000);
        this.socket.once('message', (msg, rinfo) => {
        clearTimeout(timeout);
          try {
            const payload = this.decode(msg);
            if (payload.length !== 0) {
              reject(new Error('unexptected message; handshake expected'));
            }
            setTimeout(() => { this.lastStamp = 0; }, 90000);
            resolve(newTransaction);
          } catch (err) {
            reject(err);
          }
        });  
        let handshake = Buffer.alloc(32, 0xff);
        handshake[0] = 0x21;
        handshake[1] = 0x31;
        handshake.writeUInt16BE(32, 2);
        this.send_buffer(handshake);
      } else {
        resolve(newTransaction);
      }
    });
  }

  done(transaction: MiTransaction) {
    this.transaction = transaction.close();
  } 

  send(buf) {
    return new Promise<any>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error('timeout')); }, 10000);
      this.socket.once('message', (msg, rinfo) => {
        clearTimeout(timeout);
        try {
          const payload = this.decode(msg);
          if (payload.length === 0) {
            reject(new Error('corrupted buffer; empty payload'));
          } else {
            resolve(payload);
          }
        } catch(err) {
          reject(err);
        }   
      });
      try {
        this.send_buffer(this.encode(buf));
      } catch (err) {
        reject(err);
      }
    });
  }

  private send_buffer(buf: Buffer) {
    this.socket.send(buf, this.port, this.address, (err) => {
      this.socket.emit('sent', buf);
    });
  } 

  private encode(buf: Buffer) {
    if (this.deviceId === 0 || this.lastStamp === 0) {
      throw new Error('deviceId or device stamp not available');
    }
    let header = Buffer.alloc(32, 0x00);
    header[0] = 0x21;
    header[1] = 0x31;
    header.writeUInt32BE(this.deviceId, 8);
    header.writeUInt32BE(++this.lastStamp, 12);
    header.writeUInt16BE(32 + buf.length, 2);
    const digest = crypto.createHash('md5')
      .update(header.slice(0, 16))
      .update(this.token)
      .update(buf)
      .digest()
    digest.copy(header, 16);
    return Buffer.concat([header, buf]);
  }
  
  private decode(buf: Buffer) {
    const size = buf.readUInt16BE(2);
    if (buf[0] !== 0x21 || buf[1] !== 0x31 || size < 32) {
      throw new Error('corrupted buffer; wrong header');
    }
    if (buf.length !== size) {
      throw new Error('corrupted buffer; expected ' + size.toString() + ' bytes, got ' + buf.length.toString());
    }
    const checksum = buf.slice(16, 32);
    const encrypted = buf.slice(32);
    if (encrypted.length !== 0) {
      const digest = crypto.createHash('md5')
        .update(buf.slice(0, 16))
        .update(this.token)
        .update(encrypted)
        .digest();
      if (!checksum.equals(digest)) {
        throw new Error('corrupted buffer; checksum mismatch');
      }
    }
    return encrypted; 
  }
}  // class MiSocket

export class MiDevice {
  private token : Buffer;
  private tokenKey : Buffer;
  private tokenIV : Buffer;
  private lastId : number = 0;
  private socket : MiSocket;

  constructor(
    address : string,
    port : number,
    token : string,
    private readonly log: Logger
  ) {
    // create token
    this.token = Buffer.from(token, 'hex');
    this.tokenKey = crypto.createHash('md5').update(this.token).digest();
    this.tokenIV = crypto.createHash('md5').update(this.tokenKey).update(this.token).digest();

    // create socket
    this.socket = new MiSocket(address, port, this.token);
    this.socket.on('error', (err) => { this.log.error(this.socket.name(), err.message); });
    this.socket.on('debug', (msg) => { this.log.debug(this.socket.name(), msg); });
  }

  send(method, args) {
    return new Promise<any>((resolve, reject) => {
      this.socket.executeTransaction().then((transaction) => {
        this.lastId += 1;
        if (this.lastId >= 10000) {
          this.lastId = 1;
        }
        const request = {
          id: this.lastId,
          method: method,
          params: args
        };
        const json = JSON.stringify(request);
        transaction.request(this.encode(Buffer.from(json, 'utf8')))
          .then((encrypted) => {
            const response = this.decode(encrypted);
            this.log.debug(this.socket.name(), '<-', response);
            resolve(response.result);
          })
          .catch((err) => {
            reject(err);
          });
        this.log.debug(this.socket.name(), '->', json);
      }); 
    });
  }     

  private encode(buf: Buffer) {
    let cipher = crypto.createCipheriv('aes-128-cbc', this.tokenKey, this.tokenIV);
    return Buffer.concat([
      cipher.update(buf),
      cipher.final(),
    ]);
  }

  private decode(buf: Buffer) {
    let decipher = crypto.createDecipheriv('aes-128-cbc', this.tokenKey, this.tokenIV);
    return this.parseData(Buffer.concat([decipher.update(buf), decipher.final()]));
  }

  private parseObject(str : string) {
    try {
      return JSON.parse(str);
    } catch(error) {
      // Case 1: Load for subdevices fail as they return empty values
      str = str.replace('[,]', '[null,null]');
      // for aqara body sensor (lumi.motion.aq2)
      str = str.replace('[,,]', '[null,null,null]');

      return JSON.parse(str);
    }
  }

  private parseData(data) {
    if (data[data.length - 1] === 0) {
      data = data.slice(0, data.length - 1);
    }
    let strData = data.toString('utf8');
    // Remove non-printable characters to help with invalid JSON from devices
    strData = strData.replace(/[\x00-\x09\x0B-\x0C\x0E-\x1F\x7F-\x9F]/g, ''); 
    const json = this.parseObject(strData);
    return json;
  }
}
