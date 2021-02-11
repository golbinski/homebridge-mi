import { EventEmitter } from 'events';
import { 
  PlatformAccessory,
  Service, 
  Characteristic,
  CharacteristicProps,
  CharacteristicValue,
  CharacteristicSetCallback,
  CharacteristicGetCallback,
  WithUUID,
} from 'homebridge';
import { MiPlatform } from './platform';
import { MiDevice } from './miDevice';

export type DeviceValue = string | number | boolean | null;

export interface DeviceValueFormatter {
  (value: DeviceValue) : CharacteristicValue;
}  // interface DeviceValueFormatter

export interface CharacteristicValueFormatter {
  (value: CharacteristicValue) : DeviceValue;
}  // interface CharacteristicValueFormatter

export type CharacteristicEvent = 'get' | 'set';

export interface AccessoryPropertyCharacteristic {
  readonly characteristic: string | WithUUID<new () => Characteristic>;
  readonly props?: Partial<CharacteristicProps>;
  readonly events: CharacteristicEvent[];
  readonly triggers?: string[];
  readonly formatDeviceValue?: DeviceValueFormatter;
  readonly formatCharacteristicValue?: CharacteristicValueFormatter;
}  // interface AccessoryPropertyCharacteristic
  
export interface AccessoryProperty {
  readonly did: string;
  readonly siid?: number;
  readonly piid?: number;
  readonly characteristics: AccessoryPropertyCharacteristic[];
  state: DeviceValue; 
}  // interface AccessoryProperty

export interface MiProtocol {
  methodOf(event : CharacteristicEvent, property? : AccessoryProperty) : string;
  argOf(event : CharacteristicEvent, property : AccessoryProperty, value? : DeviceValue);
  valueOf(event : CharacteristicEvent, property : AccessoryProperty, result);
}  // interface MiProtocol

export class MIIO implements MiProtocol {
  methodOf(event : CharacteristicEvent, property? : AccessoryProperty) : string {
    if (event === 'get') {
      return 'get_prop';
    } else {
      return 'set_' + property!.did;
    }
  }

  argOf(event : CharacteristicEvent, property : AccessoryProperty, value? : DeviceValue) {
    if (event === 'get') {
      return property.did;
    } else {
      return value;
    }
  }

  valueOf(event : CharacteristicEvent, property : AccessoryProperty, result)  {
    if (event === 'set' && result !== 'ok') {
      throw new Error(result);
    }
    if (event === 'get') {
      return result as DeviceValue;
    }
    return null;
  }
}  // class MIIO

export class MIOT implements MiProtocol {
  methodOf(event : CharacteristicEvent, property? : AccessoryProperty) : string {
    if (event === 'get') {
      return 'get_properties';
    } else {
      return 'set_properties';
    }
  }

  argOf(event : CharacteristicEvent, property : AccessoryProperty, value? : DeviceValue) {
    if (event === 'get') {
      return { did: property.did, siid: property.siid, piid: property.piid };
    } else {
      return { did: property.did, siid: property.siid, piid: property.piid, value: value };
    }
  }

  valueOf(event : CharacteristicEvent, property : AccessoryProperty, result) {
    if (result.code !== 0) {
      throw new Error(result.code.asString());
    }
    if (event === 'get') {
      return result.value as DeviceValue;
    }
    return null;
  }
}  // class MIOT

interface ServiceEntry {
  service: Service;
  properties: AccessoryProperty[];
}  // interface ServiceEntry

export class MiAccessory extends EventEmitter {
  protected services: ServiceEntry[] = [];
  constructor(
    protected readonly platform: MiPlatform,
    public readonly accessory: PlatformAccessory,
    protected readonly api: MiDevice,
  ) {
    super();
    this.platform.registerAccessory(this);
  }
  
  public uuid() : string {
    return this.accessory.UUID;
  }

  public config() {
    return this.accessory.context.device;
  }

  protected addService<T extends MiProtocol>(protocolType: { new(): T ;}, serviceType, properties: AccessoryProperty[]) {
    const service = this.makeService(serviceType);
    const protocol = new protocolType();
    for (const property of properties) {
      for (const characteristic of property.characteristics) {
        const hapCharacteristic = service.getCharacteristic(characteristic.characteristic!);
        if (hapCharacteristic === undefined) {
          continue;
        }
        if (characteristic.props !== undefined) {
          hapCharacteristic.setProps(characteristic.props);
        }
        if (characteristic.events.includes('get')) {
          hapCharacteristic.on('get', (callback: CharacteristicGetCallback) => {
            callback(null, characteristic.formatDeviceValue !== undefined ? 
              characteristic.formatDeviceValue(property.state) : property.state);
            if (characteristic.triggers !== undefined) {
              for (const event of characteristic.triggers) {
                this.emit(event);
              }
            }
          });
        }
        if (characteristic.events.includes('set')) {
          hapCharacteristic.on('set', (value: CharacteristicValue, callback: CharacteristicSetCallback) => {
            const dv = characteristic.formatCharacteristicValue !== undefined ?
              characteristic.formatCharacteristicValue(value) : value as DeviceValue;
            this.api.send(protocol.methodOf('set', property), [protocol.argOf('set', property, dv)])
              .then((result) => { 
                try {
                  property.state = protocol.valueOf('set', property, result[0]) ?? dv;
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
        args.push(protocol.argOf('get', property));
      }
      this.api.send(protocol.methodOf('get'), args)
        .then((result) => {
          for (let i = 0; i < properties.length; ++i) {
            const property = properties[i];
            try {
              property.state = protocol.valueOf('get', property, result[i]);
              for (const characteristic of property.characteristics) {
                service.updateCharacteristic(characteristic.characteristic,
                  characteristic.formatDeviceValue !== undefined ?
                    characteristic.formatDeviceValue(property.state) : property.state as CharacteristicValue);
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
    interface PropertyState {
      property: string;
      state: DeviceValue;
    }  // interface PropertyState
    const state : PropertyState[] = [];
    for (const property of properties) {
      state.push({ property: property.did, state: property.state });
    }
    this.platform.log.debug(this.accessory.displayName, 'refresh', JSON.stringify(state));
  }

  private makeService(serviceType) {
    const service = this.accessory.getService(serviceType) || this.accessory.addService(serviceType);
    service.setCharacteristic(this.platform.Characteristic.Name, this.config().displayName);
    return service;
  }
}  // class MiAccessory

