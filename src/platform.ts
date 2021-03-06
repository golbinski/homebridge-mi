import { API, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service, Characteristic } from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { MiAccessory } from './accessory';
import { MiDevice } from './miDevice';
import { zhimi_heater_mc2, zhimi_humidifier } from './devices';

export interface MiAccessoryConfig {
  displayName: string;
  ipAddress: string;
  token: string;
}

interface MiOptions {
  devices: MiAccessoryConfig[];
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class MiPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  private readonly accessories: PlatformAccessory[] = [];
  private readonly miAccessories: MiAccessory[] = [];

  private readonly config: MiOptions;

  constructor(
    public readonly log: Logger,
    config: PlatformConfig,
    public readonly api: API,
  ) {

    this.config = {
      devices: config.devices as MiAccessoryConfig[],
    };

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      // run the method to discover / register your devices as accessories
      this.registerDevices();
      //this.unregisterNotUsedDevices();
    });
  }

  registerAccessory(accessory: MiAccessory) {
    this.miAccessories.push(accessory);
  }
    
  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName, accessory.UUID);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
    this.buildAccessory(accessory);
  }

  buildAccessory(accessory: PlatformAccessory) {
    const device = new MiDevice(
      accessory.context.device.ipAddress,
      54321,
      accessory.context.device.token,
      this.log,
    );
    if (accessory.context.info !== undefined) {
      this.createAccessory(accessory, device);
    } else {
      device.send('miIO.info', []).then((response) => {
        accessory.context.info = response;
        this.api.updatePlatformAccessories([accessory]);
        this.createAccessory(accessory, device);
      });
    }
  }
  
  createAccessory(accessory: PlatformAccessory, device: MiDevice) {
      if (accessory.context.info.model === 'zhimi.heater.mc2') {
        new zhimi_heater_mc2(accessory.context.info, this, accessory, device);
      } else if (accessory.context.info.model === 'zhimi.humidifier.cb1') {
        new zhimi_humidifier(accessory.context.info, this, accessory, device);
      } else {
        this.log.error('Unregistering not supported device', accessory.context.info.model);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
  }

  registerDevices() {
    this.populateDevicesFromConfig(this.config.devices, this.buildAccessory.bind(this));
  }

  unregisterNotUsedDevices() {
    const configuredAccessories : string[] = [];
    for (const accessory of this.miAccessories) {
      configuredAccessories.push(accessory.uuid());
    }
    for (const cached of this.accessories) {
      const isConfigured = configuredAccessories.find(uuid => uuid === cached.UUID);
      if (!isConfigured) {
        this.log.info('Unregistering cached accessory as it is not in use:', cached.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [cached]);
      }
    }
  }

  populateDevicesFromConfig<DeviceConfig extends MiAccessoryConfig>(devices: DeviceConfig[], factory) : void {

    for (const device of devices) {

      // generate a unique id for the accessory this should be generated from
      // something globally unique, but constant, for example, the device serial
      // number or MAC address
      const uuid = this.api.hap.uuid.generate(device.ipAddress);

      // see if an accessory with the same uuid has already been registered and restored from
      // the cached devices we stored in the `configureAccessory` method above
      const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

      if (!existingAccessory) {
        // the accessory does not yet exist, so we need to create it
        this.log.info('Adding new accessory:', device.displayName);

        // create a new accessory
        const accessory = new this.api.platformAccessory(device.displayName, uuid);

        // store a copy of the device object in the `accessory.context`
        // the `context` property can be used to store any data about the accessory you may need
        accessory.context.device = device;

        // create the accessory handler for the newly create accessory
        factory(accessory);

        // link the accessory to your platform
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }
}
