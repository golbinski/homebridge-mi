import dgram from 'dgram';
import crypto from 'crypto';
import { Logger } from 'homebridge';

type ResolveHandle = (value?: MiTransaction | PromiseLike<MiTransaction>) => void; 
class MiTransaction {
  private next : MiTransaction | null = null;

  constructor(
    private readonly socket : MiSocket,
    private readonly notifier : ResolveHandle | null = null,
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
  private deviceId = 0;
  private lastStamp = 0;
  private transaction : MiTransaction | null = null;

  constructor(
      private readonly address: string,
      private readonly port: number,
      private readonly token: Buffer,
  ) {
    this.socket = dgram.createSocket('udp4');
    this.socket.on('message', (msg) => {
      if (msg instanceof Error) {
        return;
      }
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
      checksum: msg.slice(16, 32).toString('hex'),
    };
    const m = {
      header: header,
      payload: header.length === 32 ? '<handshake>' : '<encrypted>',
    };
    return m;
  }

  on(event, callback) {
    this.socket.on(event, callback);
  }

  name() {
    return this.address + '@' + this.port.toString();
  }

  executeTransaction(handler) {
    return this.openTransaction().then(handler);
  }

  openTransaction() {
    if (this.transaction !== null) {
      return new Promise<MiTransaction>((resolve) => {
        const currentTransaction = this.transaction as MiTransaction;
        const nextTransaction = new MiTransaction(this, resolve);
        currentTransaction.enqueue(nextTransaction);
      });
    }
    const newTransaction = new MiTransaction(this);
    this.transaction = newTransaction;
    return new Promise<MiTransaction>((resolve, reject) => {
      if (this.lastStamp === 0) {
        const timeout = setTimeout(() => {
          // emitting error as message to remove event listener
          this.socket.emit('message', new Error('request timed out: no handshake from device')); 
        }, 1000);
        this.socket.once('message', (msg) => {
          if (msg instanceof Error) {
            return reject(msg);
          }
          clearTimeout(timeout);
          try {
            const payload = this.decode(msg);
            if (payload.length !== 0) {
              reject(new Error('unexptected message; handshake expected'));
            }
            setTimeout(() => {
              this.lastStamp = 0; 
            }, 90000);
            resolve(newTransaction);
          } catch (err) {
            reject(err);
          }
        });  
        const handshake = Buffer.alloc(32, 0xff);
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
    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        // emitting error as message to remove event listener
        this.socket.emit('message', new Error('request timed out: no reply from device')); 
      }, 5000);
      this.socket.once('message', (msg) => {
        if (msg instanceof Error) {
          return reject(msg);
        }
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
    this.socket.send(buf, this.port, this.address, () => {
      this.socket.emit('sent', buf);
    });
  } 

  private encode(buf: Buffer) {
    if (this.deviceId === 0 || this.lastStamp === 0) {
      throw new Error('deviceId or device stamp not available');
    }
    const header = Buffer.alloc(32, 0x00);
    header[0] = 0x21;
    header[1] = 0x31;
    header.writeUInt32BE(this.deviceId, 8);
    header.writeUInt32BE(++this.lastStamp, 12);
    header.writeUInt16BE(32 + buf.length, 2);
    const digest = crypto.createHash('md5')
      .update(header.slice(0, 16))
      .update(this.token)
      .update(buf)
      .digest();
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
  private lastId = 0;
  private socket : MiSocket;

  constructor(
    address : string,
    port : number,
    token : string,
    private readonly log: Logger,
  ) {
    // create token
    this.token = Buffer.from(token, 'hex');
    this.tokenKey = crypto.createHash('md5').update(this.token).digest();
    this.tokenIV = crypto.createHash('md5').update(this.tokenKey).update(this.token).digest();

    // create socket
    this.socket = new MiSocket(address, port, this.token);
    this.socket.on('error', (err) => {
      this.log.error(this.socket.name(), err.message); 
    });
    this.socket.on('debug', (msg) => {
      this.log.debug(this.socket.name(), msg); 
    });
  }

  send(method, args) {
    return new Promise<any>((resolve, reject) => {  /* eslint-disable-line @typescript-eslint/no-explicit-any */
      this.socket.executeTransaction((transaction) => {
        transaction.request(this.encode_request(method, args))
          .then((encrypted) => {
            const response = this.decode(encrypted);
            this.log.debug(this.socket.name(), '<-', response);
            resolve(response.result);
          })
          .catch((err) => {
            transaction.request(this.encode_request(method, args, 100))
              .then((encrypted) => {
                const response = this.decode(encrypted);
                this.log.debug(this.socket.name(), '<-', response);
                resolve(response.result);
              })
              .catch(() => {
                reject(err);
              });
          });
      }); 
    });
  }     

  private encode_request(method, args, step = 1) {
    this.lastId += step;
    if (this.lastId >= 10000) {
      this.lastId = 1;
    }
    const request = {
      id: this.lastId,
      method: method,
      params: args,
    };
    const json = JSON.stringify(request);
    this.log.debug(this.socket.name(), '->', json);
    return this.encode(Buffer.from(json, 'utf8'));
  }

  private encode(buf: Buffer) {
    const cipher = crypto.createCipheriv('aes-128-cbc', this.tokenKey, this.tokenIV);
    return Buffer.concat([
      cipher.update(buf),
      cipher.final(),
    ]);
  }

  private decode(buf: Buffer) {
    const decipher = crypto.createDecipheriv('aes-128-cbc', this.tokenKey, this.tokenIV);
    const json = Buffer.concat([decipher.update(buf), decipher.final()]);
    return JSON.parse(json.toString('utf8'));
  }
}
