import { EventEmitter } from 'events';
import { PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { MiPlatform } from './platform';
import { MiDevice } from './miDevice';

export class MiAccessory extends EventEmitter {
  protected services: any[] = [];
  constructor(
    protected readonly platform: MiPlatform,
    public readonly accessory: PlatformAccessory,
    protected readonly api: MiDevice,
  ) {
    super();
    this.platform.registerAccessory(this);
  }

  protected addService(serviceType, properties) {
    const service = this.makeService(serviceType);
    for (const property of properties) {
      for (const characteristic of property.characteristics) {
        if ('props' in characteristic) {
          service.getCharacteristic(characteristic.characteristic).setProps(characteristic.props);
        }
        if (characteristic.events.includes('get')) {
          service.getCharacteristic(characteristic.characteristic)
            .on('get', (callback: CharacteristicGetCallback) => {
              callback(null, 'formatDeviceValue' in characteristic ? characteristic.formatDeviceValue(property.state) : property.state);
              if ('triggers' in characteristic) {
                for (const event of characteristic.triggers) {
                  this.emit(event);
                }
              }
            });
        }
        if (characteristic.events.includes('set')) {
          service.getCharacteristic(characteristic.characteristic)
            .on('set', (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
              let dv = value;
              if ('formatCharacteristicValue' in characteristic) {
                dv = characteristic.formatCharacteristicValue(dv);
              }
              this.api.send(this.setMethodOf(property), [this.setValueOf(property, dv)])
                .then((result) => { 
                  try {
                    property.state = this.setResultOf(property, dv, result[0]);
                    callback(null);
                  } catch (err) {
                    callback(err);
                  }
                })
                .catch((err) => {
                  callback(err);
                });
            });
        }
      }
    }
    this.on('refresh', () => {
      const args : any[] = [];
      for (const property of properties) {
        args.push(this.getValueOf(property));
      }
      this.api.send(this.getMethodOf(properties), args)
        .then((result) => {
          for (let i = 0; i < properties.length; ++i) {
            const property = properties[i];
            try {
              property.state = this.getResultOf(property, result[i]);
              for (const characteristic of property.characteristics) {
                service.updateCharacteristic(characteristic.characteristic,
                  'formatDeviceValue' in characteristic ? characteristic.formatDeviceValue(property.state) : property.state);
              }
            } catch (err) {
              this.platform.log.error(err.message);
            }
          }
          this.logState(properties);
        })
        .catch((err) => {
          this.platform.log.error(err.message);
        });
    });
    this.services.push({ service: service, properties: properties });
    return service;
  }

  private logState(properties) {
    const state : any[] = [];
    for (const property of properties) {
      state.push({ property: property.did, state: property.state });
    }
    this.platform.log.debug(this.accessory.displayName, 'refresh', JSON.stringify(state));
  }

  
  setMethodOf(property) {
    throw new Error('method not implemented');
  }

  getMethodOf(property) {
    throw new Error('method not implemented');
  }

  setValueOf(property, value) {
    throw new Error('method not implemented');
  }

  getValueOf(property) {
    throw new Error('method not implemented');
  }

  setResultOf(property, value, result) {
    throw new Error('method not implemented');
  }
  
  getResultOf(property, result) {
    throw new Error('method not implemented');
  }

  uuid() : string {
    return this.accessory.UUID;
  }

  config() {
    return this.accessory.context.device;
  }

  makeService(serviceType) {
    const service = this.accessory.getService(serviceType) || this.accessory.addService(serviceType);
    service.setCharacteristic(this.platform.Characteristic.Name, this.config().displayName);
    return service;
  }
}  // class MiAccessory

export class MiotAccessory extends MiAccessory {
  constructor(
    platform: MiPlatform,
    accessory: PlatformAccessory,
    api: MiDevice,
  ) {
    super(platform, accessory, api);
  }

  setMethodOf(property) {
    return 'set_properties';
  }

  getMethodOf(property) {
    return 'get_properties';
  }

  setValueOf(property, value) {
    return { siid: property.siid, piid: property.piid, value: value };
  }

  getValueOf(property) {
    return { siid: property.siid, piid: property.piid };
  }

  setResultOf(property, value, result) {
    if (result.code === 0) {
      return value;
    } else {
      throw new Error(result.code.toString());
    }
  }
  
  getResultOf(property, result) {
    if (result.code === 0) {
      return result.value;
    } else {
      throw new Error(result.code.toString());
    }
  }
}  // class MiotAccessory

export class MiioAccessory extends MiAccessory {
  constructor(
    platform: MiPlatform,
    accessory: PlatformAccessory,
    api: MiDevice,
  ) {
    super(platform, accessory, api);
  }

  setMethodOf(property) {
    return 'set_' + property.did;
  }

  getMethodOf(property) {
    return 'get_prop';
  }

  setValueOf(property, value) {
    return value;
  }

  getValueOf(property) {
    return property.did;
  }

  setResultOf(property, value, result) {
    if (result === 'ok') {
      return value;
    } else {
      throw new Error('error');
    }
  }
  
  getResultOf(property, result) {
    return result;
  }
}  // class MiioAccessory
