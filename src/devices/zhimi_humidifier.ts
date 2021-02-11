import { PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { MiPlatform } from '../platform';
import { MIIO, MiAccessory } from '../accessory';
import { MiDevice } from '../miDevice';

export class zhimi_humidifier extends MiAccessory {
  constructor(
    info,
    platform: MiPlatform,
    accessory: PlatformAccessory,
    api: MiDevice,
  ) {
    super(platform, accessory, api);
    const service = this.addService(MIIO, platform.Service.HumidifierDehumidifier, [
      {
        did: 'power',
        state: 'off',
        characteristics: [
          {
            characteristic: platform.Characteristic.Active,
            events: ['get', 'set'],
            triggers: ['refresh'],
            formatDeviceValue: (value) => {
              return value === 'on' ? platform.Characteristic.Active.ACTIVE
                           : platform.Characteristic.Active.INACTIVE;
            },
            formatCharacteristicValue: (value) => {
              return value === platform.Characteristic.Active.ACTIVE ? 'on' : 'off';
            },
          },
          {
            characteristic: platform.Characteristic.CurrentHumidifierDehumidifierState,
            events: ['get', 'set'],
            props: { validValues: [
                platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE,
                platform.Characteristic.CurrentHumidifierDehumidifierState.HUMIDIFYING
            ]},
            formatDeviceValue: (value) => {
              return value === 'on' ? platform.Characteristic.CurrentHumidifierDehumidifierState.HUMIDIFYING
                           : platform.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
            },
          },
        ],
      },
      {
        did: 'humidity',
        state: 40,
        characteristics: [
          {
            characteristic: platform.Characteristic.CurrentRelativeHumidity,
            events: ['get'],
          }
        ],
      },
      {
        did: 'limit_hum',
        state: 40, 
        characteristics: [
          {
            characteristic: platform.Characteristic.RelativeHumidityHumidifierThreshold,
            events: ['get', 'set'],
            props: {
              minValue: 30,
              maxValue: 80,
              minStep: 10
            },
          }
        ],
      },
      {
        did: 'depth',
        state: 50,
        characteristics: [
          {
            characteristic: platform.Characteristic.WaterLevel,
            events: ['get']
          }
        ]
      },
      {
        did: 'child_lock',
        state: 'off',
        characteristics: [
          {
            characteristic: platform.Characteristic.LockPhysicalControls,
            events: ['get', 'set'],
            formatDeviceValue: (value) => {
              return value === 'on' ? platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
                           : platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
            },
            formatCharacteristicValue: (value) => {
              return value === platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED ? 'on' : 'off';
            },
          }
        ],
      }
    ]);
    this.addService(MIIO, platform.Service.TemperatureSensor, [
      {
        did: 'temperature',
        state: 21,
        characteristics: [
          {
            characteristic: platform.Characteristic.CurrentTemperature,
            events: ['get'],
          }
        ],
      },
    ]);
    // set accessory information
    this.accessory.getService(platform.Service.AccessoryInformation)!
      .setCharacteristic(platform.Characteristic.Manufacturer, 'SMARTMI')
      .setCharacteristic(platform.Characteristic.Model, info.model)
      .setCharacteristic(platform.Characteristic.SerialNumber, info.mac)
      .setCharacteristic(platform.Characteristic.FirmwareRevision, info.fw_ver);
    service.getCharacteristic(platform.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [platform.Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER],
      })
      .on('get', (callback) => { callback(null, platform.Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER); });
    this.emit('refresh');
  }
}

