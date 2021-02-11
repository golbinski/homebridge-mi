import { PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { MiPlatform } from '../platform';
import { MIOT, MiAccessory } from '../accessory';
import { MiDevice } from '../miDevice';

export class zhimi_heater_mc2 extends MiAccessory {
  constructor(
    info,
    platform: MiPlatform,
    accessory: PlatformAccessory,
    api: MiDevice,
  ) {
    super(platform, accessory, api);
    const service = this.addService(MIOT, platform.Service.HeaterCooler, [
      {
        did: 'power',
        siid: 2,
        piid: 1,
        state: false,
        characteristics: [
          {
            characteristic: platform.Characteristic.Active,
            events: ['get', 'set'],
            triggers: ['refresh'],
            formatDeviceValue: (value) => {
              return value ? platform.Characteristic.Active.ACTIVE
                           : platform.Characteristic.Active.INACTIVE;
            },
            formatCharacteristicValue: (value) => {
              return value === platform.Characteristic.Active.ACTIVE;
            },
          },
          {
            characteristic: platform.Characteristic.CurrentHeaterCoolerState,
            events: ['get'],
            props: {
              validValues: [0, 2],
            },
            formatDeviceValue: (value) => {
              return value ? platform.Characteristic.CurrentHeaterCoolerState.HEATING
                           : platform.Characteristic.CurrentHeaterCoolerState.INACTIVE;
            },
          }
        ],
      },
      {
        did: 'target_temperature',
        siid: 2,
        piid: 5,
        state: 28,
        characteristics: [
          {
            characteristic: platform.Characteristic.HeatingThresholdTemperature,
            events: ['get', 'set'],
            props: {
              minValue: 18,
              maxValue: 28,
              minStep: 1,
            }
          }
        ],
      },
      {
        did: 'child_lock',
        siid: 5,
        piid: 1,
        state: false,
        characteristics: [
          {
            characteristic: platform.Characteristic.LockPhysicalControls,
            events: ['get', 'set'],
            formatDeviceValue: (value) => {
              return value ? platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
                           : platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
            },
            formatCharacteristicValue: (value) => {
              return value === platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
            },
          }
        ],
      },
      {
        did: 'temperature',
        siid: 4,
        piid: 7,
        state: 21,
        characteristics: [
          {
            characteristic: platform.Characteristic.CurrentTemperature,
            events: ['get'],
            props: {
              minValue: -30,
              maxValue: 100,
            }
          }
        ],
      }
    ]);
    // set accessory information
    this.accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'SMARTMI')
      .setCharacteristic(platform.Characteristic.Model, info.model)
      .setCharacteristic(platform.Characteristic.SerialNumber, info.mac)
      .setCharacteristic(platform.Characteristic.FirmwareRevision, info.fw_ver);
    service.getCharacteristic(platform.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [1],
      })
      .on('get', (callback) => { callback(null, platform.Characteristic.TargetHeaterCoolerState.HEAT); });
    service.getCharacteristic(platform.Characteristic.TemperatureDisplayUnits)
      .setProps({
        validValues: [platform.Characteristic.TemperatureDisplayUnits.CELSIUS],
      });
    this.emit('refresh');
  }
}
