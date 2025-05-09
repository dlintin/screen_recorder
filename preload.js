const { contextBridge, ipcRenderer } = require('electron');

// Add console logging for debugging
console.log('Preload script is running');

contextBridge.exposeInMainWorld('electron', {
  desktopCapturer: {
    getSources: (opts) => {
      console.log('Getting desktop sources with options:', opts);
      return ipcRenderer.invoke('DESKTOP_CAPTURER_GET_SOURCES', opts);
    },
  },
  screenInfo: {
    getResolutions: () => {
      console.log('Getting available screen resolutions');
      return ipcRenderer.invoke('GET_SCREEN_RESOLUTIONS');
    },
  },
  ipcRenderer: {
    invoke: (channel, data) => {
      console.log(`Invoking channel ${channel} with data:`, data ? true : false);
      const validChannels = ['show-save-dialog', 'save-file'];
      if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, data);
      }
      return Promise.reject(new Error(`Invalid channel: ${channel}`));
    },
  },
}); 