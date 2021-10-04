/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {ComponentType} from 'react';
import {produce} from 'immer';

import type BaseDevice from '../devices/BaseDevice';
import type Client from '../Client';
import type {UninitializedClient} from '../server/UninitializedClient';
import {performance} from 'perf_hooks';
import type {Actions} from '.';
import {WelcomeScreenStaticView} from '../sandy-chrome/WelcomeScreen';
import {isDevicePluginDefinition} from '../utils/pluginUtils';
import {getPluginKey} from '../utils/pluginKey';

import {deconstructClientId} from '../utils/clientUtils';
import type {RegisterPluginAction} from './plugins';
import {DeviceOS, Logger} from 'flipper-plugin';
import {FlipperServerImpl} from '../server/FlipperServerImpl';
import {shallowEqual} from 'react-redux';

export type StaticViewProps = {logger: Logger};

export type StaticView =
  | null
  | ComponentType<StaticViewProps>
  | React.FunctionComponent<any>;

export type State = StateV2;

export const persistVersion = 2;
export const persistMigrations = {
  1: (state: any) => {
    const stateV0 = state as StateV0;
    const stateV1 = {
      ...stateV0,
      enabledPlugins: stateV0.userStarredPlugins ?? {},
      enabledDevicePlugins:
        stateV0.userStarredDevicePlugins ??
        new Set<string>(INITAL_STATE.enabledDevicePlugins),
    };
    return stateV1 as any;
  },
  2: (state: any) => {
    const stateV1 = state as StateV1;
    const stateV2 = {
      ...stateV1,
      enabledPlugins: stateV1.enabledPlugins ?? {},
      enabledDevicePlugins:
        stateV1.enabledDevicePlugins ??
        new Set<string>(INITAL_STATE.enabledDevicePlugins),
    };
    return stateV2 as any;
  },
};

type StateV2 = {
  devices: Array<BaseDevice>;
  selectedDevice: null | BaseDevice;
  selectedPlugin: null | string;
  selectedAppId: null | string; // Full quantified identifier of the app
  userPreferredDevice: null | string;
  userPreferredPlugin: null | string;
  userPreferredApp: null | string; // The name of the preferred app, e.g. Facebook
  enabledPlugins: {[client: string]: string[]};
  enabledDevicePlugins: Set<string>;
  clients: Array<Client>;
  uninitializedClients: UninitializedClient[];
  deepLinkPayload: unknown;
  staticView: StaticView;
  selectedAppPluginListRevision: number;
  flipperServer: FlipperServerImpl | undefined;
};

type StateV1 = Omit<StateV2, 'enabledPlugins' | 'enabledDevicePlugins'> & {
  enabledPlugins?: {[client: string]: string[]};
  enabledDevicePlugins?: Set<string>;
};

type StateV0 = Omit<StateV1, 'enabledPlugins' | 'enabledDevicePlugins'> & {
  userStarredPlugins?: {[client: string]: string[]};
  userStarredDevicePlugins?: Set<string>;
};

export type Action =
  | {
      type: 'REGISTER_DEVICE';
      payload: BaseDevice;
    }
  | {
      type: 'SELECT_DEVICE';
      payload: BaseDevice;
    }
  | {
      type: 'SELECT_PLUGIN';
      payload: {
        selectedPlugin: string;
        selectedAppId?: null | string; // not set for device plugins
        deepLinkPayload?: unknown;
        selectedDevice?: BaseDevice | null;
        time: number;
      };
    }
  | {
      type: 'NEW_CLIENT';
      payload: Client;
    }
  | {
      type: 'CLIENT_REMOVED';
      payload: string;
    }
  | {
      type: 'START_CLIENT_SETUP';
      payload: UninitializedClient;
    }
  | {
      type: 'SET_STATIC_VIEW';
      payload: StaticView;
      deepLinkPayload: unknown;
    }
  | {
      type: 'SET_PLUGIN_ENABLED';
      payload: {
        pluginId: string;
        selectedApp: string;
      };
    }
  | {
      type: 'SET_DEVICE_PLUGIN_ENABLED';
      payload: {
        pluginId: string;
      };
    }
  | {
      type: 'SET_PLUGIN_DISABLED';
      payload: {
        pluginId: string;
        selectedApp: string;
      };
    }
  | {
      type: 'SET_DEVICE_PLUGIN_DISABLED';
      payload: {
        pluginId: string;
      };
    }
  | {
      type: 'SELECT_CLIENT';
      payload: string; // App ID
    }
  | {
      type: 'APP_PLUGIN_LIST_CHANGED';
    }
  | {
      type: 'SET_FLIPPER_SERVER';
      payload: FlipperServerImpl;
    }
  | RegisterPluginAction;

const DEFAULT_PLUGIN = 'DeviceLogs';
const DEFAULT_DEVICE_BLACKLIST: DeviceOS[] = ['MacOS', 'Metro', 'Windows'];
const INITAL_STATE: State = {
  devices: [],
  selectedDevice: null,
  selectedAppId: null,
  selectedPlugin: DEFAULT_PLUGIN,
  userPreferredDevice: null,
  userPreferredPlugin: null,
  userPreferredApp: null,
  enabledPlugins: {},
  enabledDevicePlugins: new Set([
    'DeviceLogs',
    'CrashReporter',
    'MobileBuilds',
    'Hermesdebuggerrn',
    'React',
  ]),
  clients: [],
  uninitializedClients: [],
  deepLinkPayload: null,
  staticView: WelcomeScreenStaticView,
  selectedAppPluginListRevision: 0,
  flipperServer: undefined,
};

export default (state: State = INITAL_STATE, action: Actions): State => {
  switch (action.type) {
    case 'SET_FLIPPER_SERVER': {
      return {
        ...state,
        flipperServer: action.payload,
      };
    }

    case 'SET_STATIC_VIEW': {
      const {payload, deepLinkPayload} = action;
      return {
        ...state,
        staticView: payload,
        deepLinkPayload: deepLinkPayload ?? null,
      };
    }

    case 'RESET_SUPPORT_FORM_V2_STATE': {
      return {
        ...state,
        staticView: null,
      };
    }

    case 'SELECT_DEVICE': {
      const {payload} = action;
      return {
        ...state,
        staticView: null,
        selectedDevice: payload,
        selectedAppId: null,
        userPreferredDevice: payload
          ? payload.title
          : state.userPreferredDevice,
      };
    }

    case 'REGISTER_DEVICE': {
      const {payload} = action;

      const newDevices = state.devices.slice();
      const existing = state.devices.findIndex(
        (device) => device.serial === payload.serial,
      );
      if (existing !== -1) {
        const d = newDevices[existing];
        if (d.connected.get()) {
          throw new Error(`Cannot register, '${d.serial}' is still connected`);
        }
        newDevices[existing] = payload;
      } else {
        newDevices.push(payload);
      }

      const selectNewDevice =
        !state.selectedDevice ||
        !state.selectedDevice.isConnected ||
        state.userPreferredDevice === payload.title;
      let selectedAppId = state.selectedAppId;

      if (selectNewDevice) {
        // need to select a different app
        selectedAppId =
          state.clients.find(
            (c) =>
              c.device === payload && c.query.app === state.userPreferredApp,
          )?.id ?? null;
        // nothing found, try first app if any
        if (!selectedAppId) {
          selectedAppId =
            state.clients.find((c) => c.device === payload)?.id ?? null;
        }
      }

      return {
        ...state,
        devices: newDevices,
        selectedDevice: selectNewDevice ? payload : state.selectedDevice,
        selectedAppId,
      };
    }

    case 'SELECT_PLUGIN': {
      const {selectedPlugin, selectedAppId, deepLinkPayload} = action.payload;

      if (selectedPlugin) {
        performance.mark(`activePlugin-${selectedPlugin}`);
      }

      const client = state.clients.find((c) => c.id === selectedAppId);
      const device = action.payload.selectedDevice ?? client?.device;

      if (!device) {
        console.warn(
          'No valid device / client provided when calling SELECT_PLUGIN',
        );
        return state;
      }

      return {
        ...state,
        staticView: null,
        selectedDevice: device,
        userPreferredDevice: canBeDefaultDevice(device)
          ? device.title
          : state.userPreferredDevice,
        selectedAppId: selectedAppId ?? null,
        userPreferredApp:
          state.clients.find((c) => c.id === selectedAppId)?.query.app ??
          state.userPreferredApp,
        selectedPlugin,
        userPreferredPlugin: selectedPlugin,
        deepLinkPayload: deepLinkPayload,
      };
    }

    case 'NEW_CLIENT': {
      const {payload} = action;

      const newClients = state.clients.filter((client) => {
        if (client.id === payload.id) {
          console.error(
            `Received a new connection for client ${client.id}, but the old connection was not cleaned up`,
          );
          return false;
        }
        return true;
      });
      newClients.push(payload);

      // select new client if nothing select, this one is preferred, or the old one is offline
      const selectNewClient =
        !state.selectedAppId ||
        state.userPreferredApp === payload.query.app ||
        state.clients
          .find((c) => c.id === state.selectedAppId)
          ?.connected.get() === false;

      return {
        ...state,
        selectedAppId: selectNewClient ? payload.id : state.selectedAppId,
        selectedDevice: selectNewClient ? payload.device : state.selectedDevice,
        clients: newClients,
        uninitializedClients: state.uninitializedClients.filter((c) => {
          return (
            c.deviceName !== payload.query.device ||
            c.appName !== payload.query.app
          );
        }),
      };
    }

    case 'SELECT_CLIENT': {
      const {payload} = action;
      const client = state.clients.find((c) => c.id === payload);

      if (!client) {
        return state;
      }

      return {
        ...state,
        selectedAppId: payload,
        selectedDevice: client.device,
        userPreferredDevice: client.device.title,
        userPreferredApp: client.query.app,
        selectedPlugin:
          state.selectedPlugin && client.supportsPlugin(state.selectedPlugin)
            ? state.selectedPlugin
            : state.userPreferredPlugin &&
              client.supportsPlugin(state.userPreferredPlugin)
            ? state.userPreferredPlugin
            : null,
      };
    }

    case 'CLIENT_REMOVED': {
      const {payload} = action;

      const newClients = state.clients.filter(
        (client) => client.id !== payload,
      );
      return {
        ...state,
        selectedAppId:
          state.selectedAppId === payload ? null : state.selectedAppId,
        clients: newClients,
      };
    }

    case 'START_CLIENT_SETUP': {
      const {payload} = action;
      return {
        ...state,
        uninitializedClients: [
          ...state.uninitializedClients.filter(
            (existing) => !shallowEqual(existing, payload),
          ),
          payload,
        ],
      };
    }
    case 'REGISTER_PLUGINS': {
      // plugins are registered after creating the base devices, so update them
      const plugins = action.payload;
      plugins.forEach((plugin) => {
        if (isDevicePluginDefinition(plugin)) {
          // smell: devices are mutable
          state.devices.forEach((device) => {
            device.loadDevicePlugin(plugin);
          });
        }
      });
      return state;
    }
    case 'SET_PLUGIN_ENABLED': {
      const {pluginId, selectedApp} = action.payload;
      return produce(state, (draft) => {
        if (!draft.enabledPlugins[selectedApp]) {
          draft.enabledPlugins[selectedApp] = [];
        }
        const plugins = draft.enabledPlugins[selectedApp];
        const idx = plugins.indexOf(pluginId);
        if (idx === -1) {
          plugins.push(pluginId);
        }
      });
    }
    case 'SET_DEVICE_PLUGIN_ENABLED': {
      const {pluginId} = action.payload;
      return produce(state, (draft) => {
        draft.enabledDevicePlugins.add(pluginId);
      });
    }
    case 'SET_PLUGIN_DISABLED': {
      const {pluginId, selectedApp} = action.payload;
      return produce(state, (draft) => {
        if (!draft.enabledPlugins[selectedApp]) {
          draft.enabledPlugins[selectedApp] = [];
        }
        const plugins = draft.enabledPlugins[selectedApp];
        const idx = plugins.indexOf(pluginId);
        if (idx !== -1) {
          plugins.splice(idx, 1);
        }
      });
    }
    case 'SET_DEVICE_PLUGIN_DISABLED': {
      const {pluginId} = action.payload;
      return produce(state, (draft) => {
        draft.enabledDevicePlugins.delete(pluginId);
      });
    }
    case 'APP_PLUGIN_LIST_CHANGED': {
      return produce(state, (draft) => {
        draft.selectedAppPluginListRevision++;
      });
    }
    default:
      return state;
  }
};

export const selectDevice = (payload: BaseDevice): Action => ({
  type: 'SELECT_DEVICE',
  payload,
});

export const setStaticView = (
  payload: StaticView,
  deepLinkPayload?: unknown,
): Action => {
  if (!payload) {
    throw new Error('Cannot set empty static view');
  }
  return {
    type: 'SET_STATIC_VIEW',
    payload,
    deepLinkPayload,
  };
};

export const selectPlugin = (payload: {
  selectedPlugin: string;
  selectedAppId?: null | string;
  selectedDevice?: null | BaseDevice;
  deepLinkPayload?: unknown;
  time?: number;
}): Action => ({
  type: 'SELECT_PLUGIN',
  payload: {...payload, time: payload.time ?? Date.now()},
});

export const selectClient = (clientId: string): Action => ({
  type: 'SELECT_CLIENT',
  payload: clientId,
});

export const setPluginEnabled = (pluginId: string, appId: string): Action => ({
  type: 'SET_PLUGIN_ENABLED',
  payload: {
    pluginId,
    selectedApp: appId,
  },
});

export const setDevicePluginEnabled = (pluginId: string): Action => ({
  type: 'SET_DEVICE_PLUGIN_ENABLED',
  payload: {
    pluginId,
  },
});

export const setDevicePluginDisabled = (pluginId: string): Action => ({
  type: 'SET_DEVICE_PLUGIN_DISABLED',
  payload: {
    pluginId,
  },
});

export const setPluginDisabled = (pluginId: string, appId: string): Action => ({
  type: 'SET_PLUGIN_DISABLED',
  payload: {
    pluginId,
    selectedApp: appId,
  },
});

export const appPluginListChanged = (): Action => ({
  type: 'APP_PLUGIN_LIST_CHANGED',
});

export function getAvailableClients(
  device: null | undefined | BaseDevice,
  clients: Client[],
): Client[] {
  if (!device) {
    return [];
  }
  return clients
    .filter(
      (client: Client) =>
        (device &&
          device.supportsOS(client.query.os) &&
          client.query.device_id === device.serial) ||
        // Old android sdk versions don't know their device_id
        // Display their plugins under all selected devices until they die out
        client.query.device_id === 'unknown',
    )
    .sort((a, b) => (a.query.app || '').localeCompare(b.query.app));
}

export function getClientByAppName(
  clients: Client[],
  appName: string | null | undefined,
): Client | undefined {
  return clients.find((client) => client.query.app === appName);
}

export function getClientById(
  clients: Client[],
  clientId: string | null | undefined,
): Client | undefined {
  return clients.find((client) => client.id === clientId);
}

export function canBeDefaultDevice(device: BaseDevice) {
  return !DEFAULT_DEVICE_BLACKLIST.includes(device.os);
}

export function getSelectedPluginKey(state: State): string | undefined {
  return state.selectedPlugin
    ? getPluginKey(
        state.selectedAppId,
        state.selectedDevice,
        state.selectedPlugin,
      )
    : undefined;
}

export function isPluginEnabled(
  enabledPlugins: State['enabledPlugins'],
  enabledDevicePlugins: State['enabledDevicePlugins'],
  app: string | null,
  pluginId: string,
): boolean {
  if (enabledDevicePlugins?.has(pluginId)) {
    return true;
  }
  if (!app || !enabledPlugins) {
    return false;
  }
  const appInfo = deconstructClientId(app);
  const enabledAppPlugins = enabledPlugins[appInfo.app];
  return enabledAppPlugins && enabledAppPlugins.indexOf(pluginId) > -1;
}
