import { Service, PlatformAccessory, CharacteristicValue, CharacteristicSetCallback, CharacteristicGetCallback } from 'homebridge';

import { MiPlatform } from './platform';
import { MiAccessory } from './accessory';
import { MiDevice } from './miDevice';

export class zhimi_heater_mc2 extends MiAccessory {
  private service: Service;
  private power = false;
  private target_temperature = 28;
  private current_temperature = 21;
  private child_lock = false; 

  constructor(
    info,
    platform: MiPlatform,
    accessory: PlatformAccessory,
    api: MiDevice,
  ) {
    super(platform, accessory, api);
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'SMARTMI')
      .setCharacteristic(this.platform.Characteristic.Model, info.model)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, info.mac)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, info.fw_ver);
    this.service = this.makeService(this.platform.Service.HeaterCooler);
    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .on('set', this.setActive.bind(this))
      .on('get', this.getActive.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState)
      .setProps({
        validValues: [0, 2],
      })
      .on('get', this.getCurrentHeaterCoolerState.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.TargetHeaterCoolerState)
      .setProps({
        validValues: [1],
      })
      .on('set', this.setTargetHeaterCoolerState.bind(this))
      .on('get', this.getTargetHeaterCoolerState.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: 18,
        maxValue: 28,
        minStep: 1,
      })
      .on('set', this.setHeatingThresholdTemperature.bind(this))
      .on('get', this.getHeatingThresholdTemperature.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .setProps({
        minValue: -30,
        maxValue: 100,
      })
      .on('get', this.getCurrentTemperature.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.LockPhysicalControls)
      .on('set', this.setLockPhysicalControls.bind(this))
      .on('get', this.getLockPhysicalControls.bind(this));
    this.service.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .setProps({
        validValues: [this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS],
      });
    this.updateCharacteristics();
  }

  updateCharacteristics() {
    this.api.send('get_properties', [
      {did: 'power', siid: 2, piid: 1},
      {did: 'target_temperature', siid: 2, piid: 5},
      {did: 'temperature', siid: 4, piid: 7},
      {did: 'child_lock', siid: 5, piid: 1},
    ]).then((result) => {
      this.power = result[0].value as boolean;
      this.target_temperature = result[1].value as number;
      this.current_temperature = result[2].value as number;
      this.child_lock = result[3].value as boolean;
      if (this.power) {
        this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState,
          this.platform.Characteristic.CurrentHeaterCoolerState.HEATING);
      } else {
        this.service.updateCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.INACTIVE);
        this.service.updateCharacteristic(this.platform.Characteristic.CurrentHeaterCoolerState,
          this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE);
      }
      this.service.updateCharacteristic(this.platform.Characteristic.HeatingThresholdTemperature, this.target_temperature);
      this.service.updateCharacteristic(this.platform.Characteristic.CurrentTemperature, this.current_temperature);
      this.service.updateCharacteristic(this.platform.Characteristic.LockPhysicalControls,
        this.child_lock ? this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED 
          : this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
    }).catch((err) => {
      this.platform.log.error(err.message); 
    });
  }

  setActive(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.api.send('set_properties', [{did: 'power', siid: 2, piid: 1, value: value ? true : false}])
      .then((result) => {
        if (result[0].code === 0) {
          callback(null);
        } else {
          callback(new Error(result[0].code as string));
        }
      })
      .catch((err) => {
        callback(err); 
      });
  }

  getActive(callback: CharacteristicGetCallback) {
    callback(null, this.power ? this.platform.Characteristic.Active.ACTIVE : this.platform.Characteristic.Active.INACTIVE);
    this.updateCharacteristics();
  }
 
  setHeatingThresholdTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.api.send('set_properties', [{did: 'target_temperature', siid: 2, piid: 5, value: value}])
      .then((result) => {
        if (result[0].code === 0) {
          callback(null);
        } else {
          callback(new Error(result[0].code as string));
        }
      })
      .catch((err) => {
        callback(err); 
      });
  }

  getHeatingThresholdTemperature(callback: CharacteristicGetCallback) {
    callback(null, this.target_temperature);
  }

  getCurrentHeaterCoolerState(callback: CharacteristicGetCallback) {
    callback(null, this.power ? this.platform.Characteristic.CurrentHeaterCoolerState.HEATING
      : this.platform.Characteristic.CurrentHeaterCoolerState.INACTIVE);
  }
  
  getTargetHeaterCoolerState(callback: CharacteristicGetCallback) {
    callback(null, this.platform.Characteristic.TargetHeaterCoolerState.HEAT);
  }
  
  setTargetHeaterCoolerState(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    callback(null);
  }

  getCurrentTemperature(callback: CharacteristicGetCallback) {
    callback(null, this.current_temperature);
  }

  getLockPhysicalControls(callback: CharacteristicGetCallback) {
    callback(null, this.child_lock ? this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED
      : this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED);
  }
  
  setLockPhysicalControls(value: CharacteristicValue, callback: CharacteristicSetCallback) {
    this.api.send('set_properties', [{did: 'child_lock', siid: 5, piid: 1, value: value ? true : false}])
      .then((result) => {
        if (result[0].code === 0) {
          callback(null);
        } else {
          callback(new Error(result[0].code as string));
        }
      })
      .catch((err) => {
        callback(err); 
      });
  }
}
