import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';
import { MiPlatform } from './platform';
import { MiDevice } from './miDevice';

export class MiAccessory {
  constructor(
    protected readonly platform: MiPlatform,
    public readonly accessory: PlatformAccessory,
    protected readonly api: MiDevice
  ) {
    this.platform.registerAccessory(this);
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
}
