/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import {State} from '../reducers';
import {
  computePluginLists,
  computeExportablePlugins,
  computeActivePluginList,
} from '../utils/pluginUtils';
import createSelector from './createSelector';

const getSelectedPluginId = (state: State) => state.connections.selectedPlugin;
const getSelectedAppId = (state: State) => state.connections.selectedAppId;
const getSelectedDevice = (state: State) => state.connections.selectedDevice;
const getClients = (state: State) => state.connections.clients;
const getDevices = (state: State) => state.connections.devices;
const getPluginDownloads = (state: State) => state.pluginDownloads;

export const getActiveClient = createSelector(
  getSelectedAppId,
  getClients,
  (selectedApp, clients) => {
    return clients.find((c) => c.id === selectedApp) || null;
  },
);

export const getMetroDevice = createSelector(getDevices, (devices) => {
  return (
    devices.find((device) => device.os === 'Metro' && !device.isArchived) ??
    null
  );
});

export const getActiveDevice = createSelector(
  getSelectedDevice,
  getActiveClient,
  getMetroDevice,
  (selectedDevice, client, metroDevice) => {
    // if not Metro device, use the selected device as metro device
    if (selectedDevice !== metroDevice) {
      return selectedDevice;
    }
    // if there is an active app, use device owning the app
    if (client) {
      return client.device;
    }
    return selectedDevice;
  },
);

export const getPluginLists = createSelector(
  ({
    connections: {
      enabledDevicePlugins,
      enabledPlugins,
      selectedAppPluginListRevision, // used only to invalidate cache
    },
  }: State) => ({
    enabledDevicePlugins,
    enabledPlugins,
    selectedAppPluginListRevision,
  }),
  ({
    plugins: {
      clientPlugins,
      devicePlugins,
      bundledPlugins,
      marketplacePlugins,
      loadedPlugins,
      disabledPlugins,
      gatekeepedPlugins,
      failedPlugins,
    },
  }: State) => ({
    clientPlugins,
    devicePlugins,
    bundledPlugins,
    marketplacePlugins,
    loadedPlugins,
    disabledPlugins,
    gatekeepedPlugins,
    failedPlugins,
  }),
  getActiveDevice,
  getMetroDevice,
  getActiveClient,
  computePluginLists,
);

export const getExportablePlugins = createSelector(
  ({plugins, connections, pluginMessageQueue}: State) => ({
    plugins,
    connections,
    pluginMessageQueue,
  }),
  getActiveDevice,
  getActiveClient,
  getPluginLists,
  computeExportablePlugins,
);
export const getActivePluginList = createSelector(
  getPluginLists,
  computeActivePluginList,
);

export const getActivePlugin = createSelector(
  getSelectedPluginId,
  getActivePluginList,
  (pluginId, pluginList) => {
    if (!pluginId) {
      return null;
    }
    return pluginList[pluginId] ?? null;
  },
);

export const getPluginDownloadStatusMap = createSelector(
  getPluginDownloads,
  (downloads) => {
    const downloadMap = new Map(
      Object.values(downloads).map((x) => [x.plugin.id, x]),
    );
    return downloadMap;
  },
);
